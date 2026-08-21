import { CoverLetterServiceConstants } from "../constants/CoverLetterServiceConstants.js";
import { ApplicationBriefContextValidationError } from "./ApplicationBriefContextValidationError.js";
import { CandidateDossierServiceError } from "./CandidateDossierServiceError.js";
import { CoverLetterServiceError } from "./CoverLetterServiceError.js";

const REQUEST_KEYS = Object.freeze(["brief", "generationToken"]);

/**
 * Orchestrates CoverLetter generation across an authenticated ApplicationBrief boundary.
 */
class CoverLetterService {
  /**
   * Create the service from authoritative trust, context, projection, and generation stages.
   * @param {object} dependencies - Service dependencies.
   * @param {import("./ApplicationBriefIntegritySigner.js").ApplicationBriefIntegritySigner} dependencies.applicationBriefIntegritySigner - Shared process signer.
   * @param {import("./OfferAnalysisService.js").OfferAnalysisService} dependencies.offerAnalysisService - Authoritative analysis workflow.
   * @param {import("./CandidateDossierService.js").CandidateDossierService} dependencies.candidateDossierService - Authoritative candidate workflow.
   * @param {import("./ApplicationBriefContextValidator.js").ApplicationBriefContextValidator} dependencies.applicationBriefContextValidator - Structural and contextual validator.
   * @param {import("./CoverLetterInputProjector.js").CoverLetterInputProjector} dependencies.coverLetterInputProjector - Minimal generation projector.
   * @param {import("./CoverLetterGenerator.js").CoverLetterGenerator} dependencies.coverLetterGenerator - CoverLetter generator.
   */
  constructor({
    applicationBriefIntegritySigner,
    offerAnalysisService,
    candidateDossierService,
    applicationBriefContextValidator,
    coverLetterInputProjector,
    coverLetterGenerator,
  }) {
    this.applicationBriefIntegritySigner = applicationBriefIntegritySigner;
    this.offerAnalysisService = offerAnalysisService;
    this.candidateDossierService = candidateDossierService;
    this.applicationBriefContextValidator = applicationBriefContextValidator;
    this.coverLetterInputProjector = coverLetterInputProjector;
    this.coverLetterGenerator = coverLetterGenerator;
  }

  /**
   * Generate one CoverLetter from an authenticated brief and current authoritative context.
   * @param {number} offerId - Canonical persisted offer identifier.
   * @param {unknown} request - Untrusted logical request envelope.
   * @returns {Promise<import("../models/CoverLetter.js").CoverLetter>} Generated domain value.
   */
  async generateForOffer(offerId, request) {
    this.validateOfferId(offerId);
    this.validateRequest(request);
    this.validateRequestSize(request);
    this.verifyAuthenticity(request.brief, request.generationToken);
    this.validateRouteBinding(request.brief, offerId);

    const analysisResult = await this.offerAnalysisService.analyze(offerId);
    let candidateResult;
    try {
      candidateResult = this.candidateDossierService.get();
    } catch (error) {
      if (!(error instanceof CandidateDossierServiceError)) {
        throw error;
      }
      throw this.internalInvariant(error);
    }
    const offerIdentity = this.buildOfferIdentity(analysisResult.identity);
    const applicationBrief = this.validateContext(request.brief, {
      offerAnalysis: analysisResult.analysis,
      offerIdentity,
      candidateDossier: candidateResult.dossier,
    });
    const generationInput = this.projectInput({
      applicationBrief,
      offerAnalysis: analysisResult.analysis,
      offerSnapshot: analysisResult.offerSnapshot,
    });
    return await this.coverLetterGenerator.generate(generationInput);
  }

  /**
   * Require one positive safe offer identifier at the service boundary.
   * @param {unknown} offerId - Offer identifier candidate.
   * @returns {void}
   */
  validateOfferId(offerId) {
    if (!Number.isSafeInteger(offerId) || offerId <= 0) {
      throw new CoverLetterServiceError(CoverLetterServiceError.CODE.INVALID_REQUEST);
    }
  }

  /**
   * Require the exact minimal plain request envelope before cryptographic work.
   * @param {unknown} request - Request candidate.
   * @returns {void}
   */
  validateRequest(request) {
    if (!this.hasExactKeys(request, REQUEST_KEYS)
      || !this.isPlainObject(request.brief)
      || typeof request.generationToken !== "string"
      || !request.generationToken.trim()) {
      throw new CoverLetterServiceError(CoverLetterServiceError.CODE.INVALID_REQUEST);
    }
  }

  /**
   * Reject unserializable or oversized complete logical envelopes without truncation.
   * @param {object} request - Minimally validated request.
   * @returns {void}
   */
  validateRequestSize(request) {
    let serialized;
    try {
      serialized = JSON.stringify(request);
    } catch (error) {
      throw new CoverLetterServiceError(CoverLetterServiceError.CODE.INVALID_REQUEST, error);
    }
    if (serialized.length > CoverLetterServiceConstants.MAX_REQUEST_CHARACTERS) {
      throw new CoverLetterServiceError(CoverLetterServiceError.CODE.REQUEST_TOO_LARGE);
    }
  }

  /**
   * Authenticate one exact brief while hiding all cryptographic failure details.
   * @param {object} brief - Untrusted brief value.
   * @param {string} generationToken - Untrusted token.
   * @returns {void}
   */
  verifyAuthenticity(brief, generationToken) {
    let authentic;
    try {
      authentic = this.applicationBriefIntegritySigner.verify(brief, generationToken);
    } catch (error) {
      throw new CoverLetterServiceError(CoverLetterServiceError.CODE.REFRESH_REQUIRED, error);
    }
    if (!authentic) {
      throw new CoverLetterServiceError(CoverLetterServiceError.CODE.REFRESH_REQUIRED);
    }
  }

  /**
   * Bind an authentic signed brief to the exact requested route offer.
   * @param {object} brief - Authenticated brief.
   * @param {number} offerId - Requested offer identifier.
   * @returns {void}
   */
  validateRouteBinding(brief, offerId) {
    if (!this.isPlainObject(brief.inputIdentity)
      || !this.isPlainObject(brief.inputIdentity.offer)
      || !Number.isSafeInteger(brief.inputIdentity.offer.offerId)
      || brief.inputIdentity.offer.offerId <= 0) {
      throw this.internalInvariant(new TypeError("Signed offer identity is invalid"));
    }
    if (brief.inputIdentity.offer.offerId !== offerId) {
      throw new CoverLetterServiceError(CoverLetterServiceError.CODE.REFRESH_REQUIRED);
    }
  }

  /**
   * Build the authoritative identity expected by the existing context validator.
   * @param {object} identity - OfferAnalysisService identity.
   * @returns {object} Minimal authoritative ApplicationBrief offer identity.
   */
  buildOfferIdentity(identity) {
    return {
      offerId: identity.offerId,
      analysisFingerprint: identity.cacheKey,
      analysisSchemaVersion: identity.schemaVersion,
      analyzerPolicyVersion: identity.policyVersion,
    };
  }

  /**
   * Revalidate an authentic brief against current authoritative context.
   * @param {object} brief - Authenticated raw brief.
   * @param {object} context - Current authoritative context.
   * @returns {import("../models/ApplicationBrief.js").ApplicationBrief} Validated brief.
   */
  validateContext(brief, context) {
    try {
      return this.applicationBriefContextValidator.validate(brief, context);
    } catch (error) {
      if (error instanceof ApplicationBriefContextValidationError
        && error.reason === ApplicationBriefContextValidationError.REASON.STALE_INPUT) {
        throw new CoverLetterServiceError(CoverLetterServiceError.CODE.REFRESH_REQUIRED, error);
      }
      if (error instanceof TypeError) {
        throw this.internalInvariant(error);
      }
      throw error;
    }
  }

  /**
   * Project only the validated minimal CoverLetter generation input.
   * @param {object} inputs - Authoritative projector inputs.
   * @returns {object} Minimal generation projection.
   */
  projectInput(inputs) {
    try {
      return this.coverLetterInputProjector.project(inputs);
    } catch (error) {
      throw this.internalInvariant(error);
    }
  }

  /**
   * Determine whether a value is a plain object with exactly the expected keys.
   * @param {unknown} value - Object candidate.
   * @param {string[]} expectedKeys - Exact allowed keys.
   * @returns {boolean} Whether the shape is exact.
   */
  hasExactKeys(value, expectedKeys) {
    if (!this.isPlainObject(value)) {
      return false;
    }
    const keys = Object.keys(value);
    return keys.length === expectedKeys.length && keys.every((key) => {
      return expectedKeys.includes(key);
    });
  }

  /**
   * Determine whether one value is a plain object record.
   * @param {unknown} value - Object candidate.
   * @returns {boolean} Whether the value is a plain object.
   */
  isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      && Object.getPrototypeOf(value) === Object.prototype;
  }

  /**
   * Create one sanitized internal invariant failure.
   * @param {Error} cause - Internal cause.
   * @returns {CoverLetterServiceError} Closed invariant error.
   */
  internalInvariant(cause) {
    return new CoverLetterServiceError(CoverLetterServiceError.CODE.INTERNAL_INVARIANT, cause);
  }
}

export { CoverLetterService };
