import { HttpStatus } from "../constants/HttpStatus.js";
import { OfferPreparationConstants } from "../constants/OfferPreparationConstants.js";
import { CoverLetterGeneratorError } from "../services/CoverLetterGeneratorError.js";
import { CoverLetterServiceError } from "../services/CoverLetterServiceError.js";
import { OfferAnalysisServiceError } from "../services/OfferAnalysisServiceError.js";
import { OfferAnalyzerError } from "../services/OfferAnalyzerError.js";
import { OfferPreparationError } from "../services/OfferPreparationError.js";

const PUBLIC_ERROR = Object.freeze({
  INVALID_OFFER_ID: "Invalid offer id",
  OFFER_NOT_FOUND: "Offer not found",
  OFFER_NOT_READY: "Offer is not ready",
  INVALID_REQUEST: "Invalid cover letter request",
  REQUEST_TOO_LARGE: "Cover letter request is too large",
  REFRESH_REQUIRED: "Application brief must be regenerated",
  INPUT_TOO_LARGE: "Cover letter generation input is too large",
  INSUFFICIENT_CLAIMS: "Cover letter requires supported claims",
  UNAVAILABLE: "Cover letter service is unavailable",
  TIMEOUT: "Cover letter service timed out",
  RATE_LIMITED: "Cover letter service is temporarily unavailable",
  PROVIDER_TOKEN_BUDGET: "Cover letter provider rejected the token budget",
  PROVIDER_ERROR: "Cover letter provider failed",
  INVALID_OUTPUT: "Cover letter provider returned an invalid response",
  INTERNAL_SERVER_ERROR: "Internal server error",
});

/**
 * Exposes trusted CoverLetter generation through a sanitized HTTP boundary.
 */
class CoverLetterController {
  /**
   * Create the controller from its service, view, and shared route parser.
   * @param {import("../services/CoverLetterService.js").CoverLetterService} coverLetterService - CoverLetter orchestrator.
   * @param {import("../views/JsonView.js").JsonView} view - JSON renderer.
   * @param {import("./OfferIdParser.js").OfferIdParser} offerIdParser - Shared canonical offer identifier parser.
   */
  constructor(coverLetterService, view, offerIdParser) {
    this.coverLetterService = coverLetterService;
    this.view = view;
    this.offerIdParser = offerIdParser;
  }

  /**
   * Generate one cover letter from the exact raw logical HTTP body.
   * @param {import("express").Request} request - Incoming request.
   * @param {import("express").Response} response - Outgoing response.
   * @returns {Promise<void>} Resolves once the response is rendered.
   */
  async generateForOffer(request, response) {
    try {
      const offerId = this.offerIdParser.parse(request.params.id);
      const coverLetter = await this.coverLetterService.generateForOffer(
        offerId,
        request.body,
      );
      this.view.renderSuccess(response, { coverLetter: coverLetter.toJson() });
    } catch (error) {
      const mapped = this.mapError(error);
      this.view.renderError(response, mapped.statusCode, mapped.message, mapped.metadata);
    }
  }

  /**
   * Map one expected or unexpected failure to a fixed public response.
   * @param {unknown} error - Boundary failure.
   * @returns {{statusCode: number, message: string, metadata: object}} Safe mapping.
   */
  mapError(error) {
    if (error instanceof OfferPreparationError) {
      return this.mapPreparationError(error);
    }
    if (error instanceof CoverLetterServiceError) {
      return this.mapServiceError(error);
    }
    if (error instanceof OfferAnalysisServiceError) {
      return this.mapAnalysisServiceError(error);
    }
    if (error instanceof OfferAnalyzerError) {
      return this.mapAnalyzerError(error);
    }
    if (error instanceof CoverLetterGeneratorError) {
      return this.mapGeneratorError(error);
    }
    return this.internalMapping();
  }

  /**
   * Map preparation failures without retaining their original message.
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
   * Map the closed CoverLetter trust service taxonomy.
   * @param {CoverLetterServiceError} error - Trust service failure.
   * @returns {object} Safe mapping.
   */
  mapServiceError(error) {
    const mappings = {
      [CoverLetterServiceError.CODE.INVALID_REQUEST]: [
        HttpStatus.BAD_REQUEST, PUBLIC_ERROR.INVALID_REQUEST, "INVALID_COVER_LETTER_REQUEST",
      ],
      [CoverLetterServiceError.CODE.REQUEST_TOO_LARGE]: [
        HttpStatus.CONTENT_TOO_LARGE, PUBLIC_ERROR.REQUEST_TOO_LARGE,
        "COVER_LETTER_REQUEST_TOO_LARGE",
      ],
      [CoverLetterServiceError.CODE.REFRESH_REQUIRED]: [
        HttpStatus.CONFLICT, PUBLIC_ERROR.REFRESH_REQUIRED,
        "APPLICATION_BRIEF_REFRESH_REQUIRED",
      ],
    };
    const mapped = mappings[error.code];
    return mapped === undefined
      ? this.internalMapping() : this.mapping(mapped[0], mapped[1], mapped[2]);
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
   * Map one OfferAnalyzer failure through the existing analysis HTTP matrix.
   * @param {OfferAnalyzerError} error - Analyzer failure.
   * @returns {object} Safe mapping.
   */
  mapAnalyzerError(error) {
    const mappings = {
      [OfferAnalyzerError.CODE.ANALYZER_INPUT_TOO_LARGE]: [HttpStatus.UNPROCESSABLE_ENTITY, "Offer content is too large to analyze"],
      [OfferAnalyzerError.CODE.ANALYZER_UNAVAILABLE]: [HttpStatus.SERVICE_UNAVAILABLE, "Offer analysis service is unavailable"],
      [OfferAnalyzerError.CODE.ANALYZER_TIMEOUT]: [HttpStatus.SERVICE_UNAVAILABLE, "Offer analysis service timed out"],
      [OfferAnalyzerError.CODE.ANALYZER_RATE_LIMITED]: [HttpStatus.SERVICE_UNAVAILABLE, "Offer analysis service is temporarily unavailable"],
      [OfferAnalyzerError.CODE.ANALYZER_PROVIDER_TOKEN_BUDGET]: [HttpStatus.BAD_GATEWAY, "Offer analysis provider rejected the token budget"],
      [OfferAnalyzerError.CODE.ANALYZER_PROVIDER_ERROR]: [HttpStatus.BAD_GATEWAY, "Offer analysis provider failed"],
      [OfferAnalyzerError.CODE.ANALYZER_INVALID_OUTPUT]: [HttpStatus.BAD_GATEWAY, "Offer analysis provider returned an invalid response"],
    };
    const mapped = mappings[error.code];
    if (mapped === undefined) {
      return this.mapping(
        HttpStatus.BAD_GATEWAY,
        "Offer analysis provider failed",
        OfferAnalyzerError.CODE.ANALYZER_PROVIDER_ERROR,
      );
    }
    return this.mapping(mapped[0], mapped[1], error.code);
  }

  /**
   * Map the closed CoverLetter generator taxonomy.
   * @param {CoverLetterGeneratorError} error - Generator failure.
   * @returns {object} Safe mapping.
   */
  mapGeneratorError(error) {
    const code = CoverLetterGeneratorError.CODE;
    const mappings = {
      [code.INPUT_TOO_LARGE]: [HttpStatus.UNPROCESSABLE_ENTITY, PUBLIC_ERROR.INPUT_TOO_LARGE],
      [code.INSUFFICIENT_SUPPORTED_CLAIMS]: [HttpStatus.UNPROCESSABLE_ENTITY, PUBLIC_ERROR.INSUFFICIENT_CLAIMS],
      [code.UNAVAILABLE]: [HttpStatus.SERVICE_UNAVAILABLE, PUBLIC_ERROR.UNAVAILABLE],
      [code.TIMEOUT]: [HttpStatus.SERVICE_UNAVAILABLE, PUBLIC_ERROR.TIMEOUT],
      [code.RATE_LIMITED]: [HttpStatus.SERVICE_UNAVAILABLE, PUBLIC_ERROR.RATE_LIMITED],
      [code.PROVIDER_TOKEN_BUDGET]: [HttpStatus.BAD_GATEWAY, PUBLIC_ERROR.PROVIDER_TOKEN_BUDGET],
      [code.PROVIDER_ERROR]: [HttpStatus.BAD_GATEWAY, PUBLIC_ERROR.PROVIDER_ERROR],
      [code.INVALID_OUTPUT]: [HttpStatus.BAD_GATEWAY, PUBLIC_ERROR.INVALID_OUTPUT],
    };
    const mapped = mappings[error.code];
    return mapped === undefined
      ? this.internalMapping() : this.mapping(mapped[0], mapped[1], error.code);
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
    return this.mapping(
      HttpStatus.INTERNAL_SERVER_ERROR,
      PUBLIC_ERROR.INTERNAL_SERVER_ERROR,
      "INTERNAL_SERVER_ERROR",
    );
  }
}

export { CoverLetterController };
