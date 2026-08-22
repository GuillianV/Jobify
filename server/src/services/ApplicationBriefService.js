import { ApplicationBriefContextValidationError } from "./ApplicationBriefContextValidationError.js";
import { ApplicationBriefMatcherError } from "./ApplicationBriefMatcherError.js";
import { GroqJsonClientError } from "./GroqJsonClientError.js";

const INVALID_OUTPUT_DIAGNOSTIC_EVENT = "application_brief_semantic_matcher_invalid_output";
const CONTEXTUAL_SUBCODES = new Set([
  ApplicationBriefContextValidationError.REASON.INVALID_EVIDENCE_REFERENCE,
  ApplicationBriefContextValidationError.REASON.INVALID_OFFER_REFERENCE,
  ApplicationBriefContextValidationError.REASON.FACET_NOT_IN_REQUIREMENT,
  ApplicationBriefContextValidationError.REASON.INCOMPLETE_REQUIREMENT_COVERAGE,
]);

/**
 * Orchestrates one on-demand ApplicationBrief from authoritative server-side inputs.
 */
class ApplicationBriefService {
  /**
   * Create the service from the existing analysis, candidate, and builder workflows.
   * @param {object} dependencies - Service dependencies.
   * @param {import("./OfferAnalysisService.js").OfferAnalysisService} dependencies.offerAnalysisService - Cached offer analysis workflow.
   * @param {import("./CandidateDossierService.js").CandidateDossierService} dependencies.candidateDossierService - Authoritative candidate workflow.
   * @param {import("./ApplicationBriefBuilder.js").ApplicationBriefBuilder} dependencies.applicationBriefBuilder - Brief builder.
   * @param {import("./ApplicationBriefIntegritySigner.js").ApplicationBriefIntegritySigner} dependencies.applicationBriefIntegritySigner - Shared process signer.
   * @param {object} [dependencies.logger] - Server diagnostic sink.
   */
  constructor({
    offerAnalysisService,
    candidateDossierService,
    applicationBriefBuilder,
    applicationBriefIntegritySigner,
    logger = console,
  }) {
    this.offerAnalysisService = offerAnalysisService;
    this.candidateDossierService = candidateDossierService;
    this.applicationBriefBuilder = applicationBriefBuilder;
    this.applicationBriefIntegritySigner = applicationBriefIntegritySigner;
    this.logger = logger;
  }

  /**
   * Generate one brief for an offer using only authoritative server-side inputs.
   * @param {number} offerId - Requested persisted offer identifier.
   * @returns {Promise<{brief: object, generationToken: string}>} Signed brief envelope.
   */
  async generateForOffer(offerId) {
    const analysisResult = await this.offerAnalysisService.analyze(offerId);
    const candidateResult = this.candidateDossierService.get();
    const identity = analysisResult.identity;
    let applicationBrief;
    try {
      applicationBrief = await this.applicationBriefBuilder.build({
        offerAnalysis: analysisResult.analysis,
        offerSnapshot: analysisResult.offerSnapshot,
        offerIdentity: {
          offerId: identity.offerId,
          analysisFingerprint: identity.cacheKey,
          analysisSchemaVersion: identity.schemaVersion,
          analyzerPolicyVersion: identity.policyVersion,
        },
        candidateDossier: candidateResult.dossier,
      });
    } catch (error) {
      this.logInvalidOutputDiagnostic(error);
      throw error;
    }
    const brief = applicationBrief.toJson();
    const generationToken = this.applicationBriefIntegritySigner.sign(brief);
    return { brief, generationToken };
  }

  /**
   * Emit one terminal safe matcher diagnostic without changing propagation.
   * @param {unknown} error - Terminal builder failure.
   * @returns {void}
   */
  logInvalidOutputDiagnostic(error) {
    if (!(error instanceof ApplicationBriefMatcherError)
      || error.code !== ApplicationBriefMatcherError.CODE.INVALID_OUTPUT) {
      return;
    }
    const details = this.resolveInvalidOutputDetails(error);
    try {
      this.logger.warn(JSON.stringify({
        event: INVALID_OUTPUT_DIAGNOSTIC_EVENT,
        validationCode: details.validationCode,
        validationSubcode: details.validationSubcode,
      }));
    } catch {
      return;
    }
  }

  /**
   * Resolve one terminal error into closed contextually coherent diagnostics.
   * @param {ApplicationBriefMatcherError} error - Terminal invalid-output failure.
   * @returns {{validationCode: string|null, validationSubcode: string|null}} Safe details.
   */
  resolveInvalidOutputDetails(error) {
    const codes = ApplicationBriefMatcherError.VALIDATION_CODE;
    if (error.reason === ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT
      && error.cause instanceof GroqJsonClientError
      && error.cause.code === GroqJsonClientError.CODE.INVALID_RESPONSE) {
      return ApplicationBriefMatcherError.createSafeDetails(
        codes.PROVIDER_INVALID_RESPONSE,
        null,
      );
    }
    if (error.reason === ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT) {
      const semanticCode = codes.SEMANTIC_VALIDATION;
      return ApplicationBriefMatcherError.createSafeDetails(
        error.safeDetails?.validationCode === semanticCode ? semanticCode : null,
        error.safeDetails?.validationSubcode,
      );
    }
    const contextualSubcode = error.reason
      === ApplicationBriefMatcherError.REASON.INVALID_CONTEXTUAL_OUTPUT
      && CONTEXTUAL_SUBCODES.has(error.cause?.reason)
      ? error.cause.reason
      : null;
    if (contextualSubcode !== null) {
      return {
        validationCode: codes.CONTEXTUAL_VALIDATION,
        validationSubcode: contextualSubcode,
      };
    }
    return { validationCode: null, validationSubcode: null };
  }
}

export { ApplicationBriefService };
