import { HttpStatus } from "../constants/HttpStatus.js";
import { OfferPreparationConstants } from "../constants/OfferPreparationConstants.js";
import { ApplicationBriefContextValidationError } from "../services/ApplicationBriefContextValidationError.js";
import { ApplicationBriefMatcherError } from "../services/ApplicationBriefMatcherError.js";
import { CandidateDossierServiceError } from "../services/CandidateDossierServiceError.js";
import { OfferAnalysisServiceError } from "../services/OfferAnalysisServiceError.js";
import { OfferAnalyzerError } from "../services/OfferAnalyzerError.js";
import { OfferPreparationError } from "../services/OfferPreparationError.js";

const CANONICAL_OFFER_ID_PATTERN = /^[1-9]\d*$/u;
const PUBLIC_ERROR = Object.freeze({
  INVALID_OFFER_ID: "Invalid offer id",
  OFFER_NOT_FOUND: "Offer not found",
  OFFER_NOT_READY: "Offer is not ready",
  INPUT_TOO_LARGE: "Application brief input is too large",
  UNAVAILABLE: "Application brief service is unavailable",
  TIMEOUT: "Application brief service timed out",
  RATE_LIMITED: "Application brief service is temporarily unavailable",
  PROVIDER_TOKEN_BUDGET: "Application brief provider rejected the token budget",
  PROVIDER_ERROR: "Application brief provider failed",
  INVALID_OUTPUT: "Application brief provider returned an invalid response",
  STALE_INPUT: "Application brief inputs changed",
  INTERNAL_SERVER_ERROR: "Internal server error",
});

/**
 * Exposes on-demand ApplicationBrief generation through a sanitized HTTP boundary.
 */
class ApplicationBriefController {
  /**
   * Create the controller from its service and JSON view.
   * @param {import("../services/ApplicationBriefService.js").ApplicationBriefService} applicationBriefService - Brief orchestrator.
   * @param {import("../views/JsonView.js").JsonView} view - JSON renderer.
   */
  constructor(applicationBriefService, view) {
    this.applicationBriefService = applicationBriefService;
    this.view = view;
  }

  /**
   * Generate one brief selected only by the canonical offer route identifier.
   * @param {import("express").Request} request - Incoming request.
   * @param {import("express").Response} response - Outgoing response.
   * @returns {Promise<void>} Resolves once the response is rendered.
   */
  async generateForOffer(request, response) {
    try {
      const offerId = this.parseOfferId(request.params.id);
      const brief = await this.applicationBriefService.generateForOffer(offerId);
      this.view.renderSuccess(response, { brief: brief.toJson() });
    } catch (error) {
      const mapped = this.mapError(error);
      this.view.renderError(response, mapped.statusCode, mapped.message, mapped.metadata);
    }
  }

  /**
   * Parse one canonical positive decimal SQLite identifier.
   * @param {unknown} rawId - Raw route identifier.
   * @returns {number} Safe positive identifier.
   */
  parseOfferId(rawId) {
    if (typeof rawId !== "string" || !CANONICAL_OFFER_ID_PATTERN.test(rawId)) {
      throw new OfferPreparationError(PUBLIC_ERROR.INVALID_OFFER_ID, HttpStatus.BAD_REQUEST);
    }
    const offerId = Number(rawId);
    if (!Number.isSafeInteger(offerId) || offerId <= 0) {
      throw new OfferPreparationError(PUBLIC_ERROR.INVALID_OFFER_ID, HttpStatus.BAD_REQUEST);
    }
    return offerId;
  }

  /**
   * Map one expected or unexpected failure to a safe public response.
   * @param {unknown} error - Boundary failure.
   * @returns {{statusCode: number, message: string, metadata: object}} Safe mapping.
   */
  mapError(error) {
    if (error instanceof OfferPreparationError) {
      return this.mapPreparationError(error);
    }
    if (error instanceof OfferAnalysisServiceError) {
      return this.mapAnalysisServiceError(error);
    }
    if (error instanceof OfferAnalyzerError) {
      return this.mapAnalyzerError(error);
    }
    if (error instanceof ApplicationBriefMatcherError) {
      return this.mapMatcherError(error);
    }
    if (error instanceof ApplicationBriefContextValidationError
      && error.reason === ApplicationBriefContextValidationError.REASON.STALE_INPUT) {
      return this.mapping(HttpStatus.CONFLICT, PUBLIC_ERROR.STALE_INPUT, "APPLICATION_BRIEF_STALE_INPUT");
    }
    if (error instanceof CandidateDossierServiceError) {
      return this.internalMapping();
    }
    return this.internalMapping();
  }

  /**
   * Map offer preparation failures without retaining their original message.
   * @param {OfferPreparationError} error - Preparation failure.
   * @returns {object} Safe mapping.
   */
  mapPreparationError(error) {
    const notFound = error.statusCode === HttpStatus.NOT_FOUND;
    return this.mapping(
      notFound ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST,
      notFound ? PUBLIC_ERROR.OFFER_NOT_FOUND : PUBLIC_ERROR.INVALID_OFFER_ID,
      notFound ? "OFFER_NOT_FOUND" : "INVALID_OFFER_ID",
    );
  }

  /**
   * Map the closed OfferAnalysis orchestration taxonomy.
   * @param {OfferAnalysisServiceError} error - Analysis service failure.
   * @returns {object} Safe mapping.
   */
  mapAnalysisServiceError(error) {
    if (error.code === OfferAnalysisServiceError.CODE.OFFER_NOT_READY) {
      const mapping = this.mapping(HttpStatus.CONFLICT, PUBLIC_ERROR.OFFER_NOT_READY, error.code);
      const statuses = [
        OfferPreparationConstants.STATUS.NEEDS_PROVIDER_ACQUISITION,
        OfferPreparationConstants.STATUS.NEEDS_USER_TEXT,
      ];
      if (statuses.includes(error.safeDetails.prepareStatus)) {
        mapping.metadata.prepareStatus = error.safeDetails.prepareStatus;
      }
      return mapping;
    }
    return this.internalMapping();
  }

  /**
   * Map one OfferAnalyzer failure consistently with the existing analysis endpoint.
   * @param {OfferAnalyzerError} error - Analyzer failure.
   * @returns {object} Safe mapping.
   */
  mapAnalyzerError(error) {
    const mappings = {
      [OfferAnalyzerError.CODE.ANALYZER_INPUT_TOO_LARGE]: [HttpStatus.UNPROCESSABLE_ENTITY, "Offer content is too large to analyze"],
      [OfferAnalyzerError.CODE.ANALYZER_UNAVAILABLE]: [HttpStatus.SERVICE_UNAVAILABLE, "Offer analysis service is unavailable"],
      [OfferAnalyzerError.CODE.ANALYZER_TIMEOUT]: [HttpStatus.SERVICE_UNAVAILABLE, "Offer analysis service timed out"],
      [OfferAnalyzerError.CODE.ANALYZER_RATE_LIMITED]: [HttpStatus.SERVICE_UNAVAILABLE, "Offer analysis service is temporarily unavailable"],
      [OfferAnalyzerError.CODE.ANALYZER_PROVIDER_ERROR]: [HttpStatus.BAD_GATEWAY, "Offer analysis provider failed"],
      [OfferAnalyzerError.CODE.ANALYZER_PROVIDER_TOKEN_BUDGET]: [HttpStatus.BAD_GATEWAY, "Offer analysis provider rejected the token budget"],
      [OfferAnalyzerError.CODE.ANALYZER_INVALID_OUTPUT]: [HttpStatus.BAD_GATEWAY, "Offer analysis provider returned an invalid response"],
    };
    const mapped = mappings[error.code];
    if (!mapped) {
      return this.mapping(HttpStatus.BAD_GATEWAY, "Offer analysis provider failed", OfferAnalyzerError.CODE.ANALYZER_PROVIDER_ERROR);
    }
    return this.mapping(mapped[0], mapped[1], error.code);
  }

  /**
   * Map one ApplicationBrief matcher failure through its closed code taxonomy.
   * @param {ApplicationBriefMatcherError} error - Matcher failure.
   * @returns {object} Safe mapping.
   */
  mapMatcherError(error) {
    const mappings = {
      [ApplicationBriefMatcherError.CODE.INPUT_TOO_LARGE]: [HttpStatus.UNPROCESSABLE_ENTITY, PUBLIC_ERROR.INPUT_TOO_LARGE],
      [ApplicationBriefMatcherError.CODE.UNAVAILABLE]: [HttpStatus.SERVICE_UNAVAILABLE, PUBLIC_ERROR.UNAVAILABLE],
      [ApplicationBriefMatcherError.CODE.TIMEOUT]: [HttpStatus.SERVICE_UNAVAILABLE, PUBLIC_ERROR.TIMEOUT],
      [ApplicationBriefMatcherError.CODE.RATE_LIMITED]: [HttpStatus.SERVICE_UNAVAILABLE, PUBLIC_ERROR.RATE_LIMITED],
      [ApplicationBriefMatcherError.CODE.PROVIDER_TOKEN_BUDGET]: [HttpStatus.BAD_GATEWAY, PUBLIC_ERROR.PROVIDER_TOKEN_BUDGET],
      [ApplicationBriefMatcherError.CODE.PROVIDER_ERROR]: [HttpStatus.BAD_GATEWAY, PUBLIC_ERROR.PROVIDER_ERROR],
      [ApplicationBriefMatcherError.CODE.INVALID_OUTPUT]: [HttpStatus.BAD_GATEWAY, PUBLIC_ERROR.INVALID_OUTPUT],
    };
    const mapped = mappings[error.code];
    if (!mapped) {
      return this.internalMapping();
    }
    return this.mapping(mapped[0], mapped[1], error.code);
  }

  /**
   * Build one safe response mapping.
   * @param {number} statusCode - HTTP status.
   * @param {string} message - Public message.
   * @param {string} code - Public code.
   * @returns {{statusCode: number, message: string, metadata: object}} Mapping.
   */
  mapping(statusCode, message, code) {
    return { statusCode, message, metadata: { code } };
  }

  /**
   * Build the generic sanitized internal failure mapping.
   * @returns {{statusCode: number, message: string, metadata: object}} Mapping.
   */
  internalMapping() {
    return this.mapping(HttpStatus.INTERNAL_SERVER_ERROR, PUBLIC_ERROR.INTERNAL_SERVER_ERROR, "INTERNAL_SERVER_ERROR");
  }
}

export { ApplicationBriefController };
