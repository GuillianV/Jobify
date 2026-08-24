import { ApplicationBriefMatcherConstants } from "../constants/ApplicationBriefMatcherConstants.js";
import { ApplicationBriefContextValidationError } from "./ApplicationBriefContextValidationError.js";
import { ApplicationBriefMatcherError } from "./ApplicationBriefMatcherError.js";
import { ApplicationBriefProviderDiagnostics } from "./ApplicationBriefProviderDiagnostics.js";
import { GroqJsonClientError } from "./GroqJsonClientError.js";

const INVALID_OUTPUT_DIAGNOSTIC_EVENT = "application_brief_semantic_matcher_invalid_output";
const PROVIDER_ERROR_DIAGNOSTIC_EVENT = "application_brief_semantic_matcher_provider_error";
const CONTEXTUAL_SUBCODES = new Set([
  ApplicationBriefContextValidationError.REASON.INVALID_EVIDENCE_REFERENCE,
  ApplicationBriefContextValidationError.REASON.INVALID_OFFER_REFERENCE,
  ApplicationBriefContextValidationError.REASON.FACET_NOT_IN_REQUIREMENT,
  ApplicationBriefContextValidationError.REASON.INCOMPLETE_REQUIREMENT_COVERAGE,
  ApplicationBriefContextValidationError.REASON
    .MISSING_SUPPORTED_CLAIMS_WITH_POSITIVE_EVIDENCE,
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
      this.logProviderErrorDiagnostic(error);
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
        ...details,
      }));
    } catch {
      return;
    }
  }

  /**
   * Emit one terminal safe provider diagnostic without changing propagation.
   * @param {unknown} error - Terminal builder failure.
   * @returns {void}
   */
  logProviderErrorDiagnostic(error) {
    if (!(error instanceof ApplicationBriefMatcherError)
      || !this.isProviderDiagnosticError(error)
      || (error.code === ApplicationBriefMatcherError.CODE.RATE_LIMITED
        && error.reason === ApplicationBriefMatcherError.REASON.RATE_LIMIT_HEADROOM_SKIP)) {
      return;
    }
    const details = this.resolveProviderErrorDetails(error);
    try {
      this.logger.warn(JSON.stringify({
        event: PROVIDER_ERROR_DIAGNOSTIC_EVENT,
        status: details.status,
        providerType: details.providerType,
        providerCode: details.providerCode,
        ...ApplicationBriefProviderDiagnostics.createRateLimitDetails(details),
      }));
    } catch {
      return;
    }
  }

  /**
   * Re-sanitize one typed provider cause into the canonical closed HTTP shape.
   * @param {ApplicationBriefMatcherError} error - Terminal provider failure.
   * @returns {object} Safe closed provider details.
   */
  resolveProviderErrorDetails(error) {
    const cause = error.cause;
    if (!(cause instanceof GroqJsonClientError)) {
      return GroqJsonClientError.createHttpSafeDetails();
    }
    if (cause.code === GroqJsonClientError.CODE.HTTP_ERROR) {
      return GroqJsonClientError.createHttpSafeDetails(
        cause.safeDetails?.status,
        cause.safeDetails?.providerType,
        cause.safeDetails?.providerCode,
        cause.safeDetails,
      );
    }
    if (cause.code === GroqJsonClientError.CODE.RATE_LIMITED) {
      return GroqJsonClientError.createHttpSafeDetails(
        cause.safeDetails?.status,
        null,
        null,
        cause.safeDetails,
      );
    }
    if (cause.code === GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED) {
      const constants = ApplicationBriefMatcherConstants;
      return GroqJsonClientError.createHttpSafeDetails(
        constants.TOKEN_BUDGET_HTTP_STATUS,
        constants.TOKEN_BUDGET_PROVIDER_TYPE,
        constants.TOKEN_BUDGET_PROVIDER_CODE,
        cause.safeDetails,
      );
    }
    if (cause.code === GroqJsonClientError.CODE.UNAVAILABLE
      || cause.code === GroqJsonClientError.CODE.TIMEOUT
      || cause.code === GroqJsonClientError.CODE.AUTHENTICATION_ERROR) {
      return GroqJsonClientError.createHttpSafeDetails(
        cause.safeDetails?.status,
        null,
        null,
        cause.safeDetails,
      );
    }
    return GroqJsonClientError.createHttpSafeDetails();
  }

  /**
   * Accept only matcher classifications backed by provider HTTP diagnostics.
   * @param {ApplicationBriefMatcherError} error - Terminal matcher failure.
   * @returns {boolean} Whether a terminal provider diagnostic is applicable.
   */
  isProviderDiagnosticError(error) {
    return new Set([
      ApplicationBriefMatcherError.CODE.PROVIDER_ERROR,
      ApplicationBriefMatcherError.CODE.RATE_LIMITED,
      ApplicationBriefMatcherError.CODE.PROVIDER_TOKEN_BUDGET,
      ApplicationBriefMatcherError.CODE.UNAVAILABLE,
      ApplicationBriefMatcherError.CODE.TIMEOUT,
    ]).has(error.code);
  }

  /**
   * Resolve one terminal error into closed contextually coherent diagnostics.
   * @param {ApplicationBriefMatcherError} error - Terminal invalid-output failure.
   * @returns {object} Safe closed validation details.
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
        error.safeDetails?.validationPath,
        error.safeDetails?.validationCategory,
        error.safeDetails?.validationRule,
        error.safeDetails?.cardinalityRule,
      );
    }
    const contextualSubcode = error.reason
      === ApplicationBriefMatcherError.REASON.INVALID_CONTEXTUAL_OUTPUT
      && CONTEXTUAL_SUBCODES.has(error.cause?.reason)
      ? error.cause.reason
      : null;
    if (contextualSubcode !== null) {
      const details = {
        validationCode: codes.CONTEXTUAL_VALIDATION,
        validationSubcode: contextualSubcode,
      };
      if (contextualSubcode
        === ApplicationBriefContextValidationError.REASON.INVALID_EVIDENCE_REFERENCE) {
        Object.assign(
          details,
          ApplicationBriefContextValidationError.createEvidenceSafeDetails(
            error.cause.safeDetails,
          ),
        );
      }
      return details;
    }
    return { validationCode: null, validationSubcode: null };
  }
}

export { ApplicationBriefService };
