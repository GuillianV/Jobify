import { SearchCriteria } from "../models/SearchCriteria.js";
import { JobOffer } from "../models/JobOffer.js";
import { HttpStatus } from "../constants/HttpStatus.js";
import { OfferPreparationConstants } from "../constants/OfferPreparationConstants.js";
import { OfferAnalysisServiceError } from "../services/OfferAnalysisServiceError.js";
import { OfferAnalyzerError } from "../services/OfferAnalyzerError.js";
import { OfferPreparationError } from "../services/OfferPreparationError.js";

const CANONICAL_OFFER_ID_PATTERN = /^[1-9]\d*$/u;
const PUBLIC_ANALYSIS_ERROR = Object.freeze({
  INVALID_OFFER_ID: "Invalid offer id",
  OFFER_NOT_FOUND: "Offer not found",
  OFFER_NOT_READY: "Offer is not ready",
  ANALYZER_INPUT_TOO_LARGE: "Offer content is too large to analyze",
  ANALYZER_UNAVAILABLE: "Offer analysis service is unavailable",
  ANALYZER_TIMEOUT: "Offer analysis service timed out",
  ANALYZER_RATE_LIMITED: "Offer analysis service is temporarily unavailable",
  ANALYZER_PROVIDER_ERROR: "Offer analysis provider failed",
  ANALYZER_PROVIDER_TOKEN_BUDGET: "Offer analysis provider rejected the token budget",
  ANALYZER_INVALID_OUTPUT: "Offer analysis provider returned an invalid response",
  INTERNAL_SERVER_ERROR: "Internal server error",
});

/**
 * Controller exposing the offer search resource of the API.
 */
class OfferController {
  /**
   * Create the controller with its dependencies.
   * @param {import("../services/OfferSearchService.js").OfferSearchService} offerSearchService - Search service.
   * @param {import("../services/CommuneResolver.js").CommuneResolver} communeResolver - City to INSEE resolver.
   * @param {import("../views/JsonView.js").JsonView} view - JSON view.
   * @param {import("../services/OfferContentAcquisitionService.js").OfferContentAcquisitionService} offerContentAcquisitionService - DETAIL acquisition service.
   * @param {import("../services/OfferPreparationService.js").OfferPreparationService} offerPreparationService - Preparation flow.
   * @param {import("../services/OfferAnalysisService.js").OfferAnalysisService} offerAnalysisService - Cached analysis runtime.
   */
  constructor(
    offerSearchService,
    communeResolver,
    view,
    offerContentAcquisitionService,
    offerPreparationService,
    offerAnalysisService,
  ) {
    this.offerSearchService = offerSearchService;
    this.communeResolver = communeResolver;
    this.view = view;
    this.offerContentAcquisitionService = offerContentAcquisitionService;
    this.offerPreparationService = offerPreparationService;
    this.offerAnalysisService = offerAnalysisService;
  }

  /**
   * Build the search criteria from the request. When a free-text location is
   * given without an explicit INSEE code, the city is resolved so that France
   * Travail filters by commune like the other sources.
   * @param {import("express").Request} request - The incoming request.
   * @returns {Promise<SearchCriteria>} The parsed criteria.
   */
  async buildCriteria(request) {
    const distanceRaw = request.query.distance;
    const parsedDistance = distanceRaw ? Number(distanceRaw) : Number.NaN;
    const distanceKm = Number.isNaN(parsedDistance) ? undefined : parsedDistance;
    const location = request.query.lieu ?? null;
    let communeInsee = request.query.commune ?? null;
    if (!communeInsee && location) {
      communeInsee = await this.communeResolver.resolve(location);
    }
    return new SearchCriteria({
      keywords: request.query.motsCles ?? "",
      communeInsee,
      location,
      distanceKm,
    });
  }

  /**
   * Rebuild the offers scraped client-side into JobOffer instances so they flow
   * through the same deduplication pipeline as the API sources.
   * @param {unknown} scrapedOffers - The raw scraped offers from the request body.
   * @returns {JobOffer[]} The reconstructed offers.
   */
  reconstructScrapedOffers(scrapedOffers) {
    if (!Array.isArray(scrapedOffers)) {
      return [];
    }
    return scrapedOffers.map((json) => {
      return JobOffer.fromJson(json);
    });
  }

  /**
   * Parse one canonical positive decimal SQLite identifier from an HTTP path.
   * @param {unknown} rawId - Raw route parameter.
   * @returns {number} Safe positive identifier.
   */
  parseOfferId(rawId) {
    if (typeof rawId !== "string" || !CANONICAL_OFFER_ID_PATTERN.test(rawId)) {
      throw new OfferPreparationError("Invalid offer id", HttpStatus.BAD_REQUEST);
    }
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new OfferPreparationError("Invalid offer id", HttpStatus.BAD_REQUEST);
    }
    return id;
  }

  /**
   * Handle a request to search offers across every configured source, merging
   * any client-scraped offers, then persist the result.
   * @param {import("express").Request} request - The incoming request.
   * @param {import("express").Response} response - The outgoing response.
   * @returns {Promise<void>} Resolves once the response has been sent.
   */
  async searchOffers(request, response) {
    try {
      const criteria = await this.buildCriteria(request);
      const injectedOffers = this.reconstructScrapedOffers(request.body?.scrapedOffers);
      const offers = await this.offerSearchService.search(criteria, injectedOffers);
      this.view.renderSuccess(response, {
        count: offers.length,
        offres: offers.map((offer) => {
          return this.toApiJson(offer);
        }),
      });
    } catch (error) {
      this.view.renderError(response, HttpStatus.INTERNAL_SERVER_ERROR, error.message);
    }
  }

  /**
   * Enrich one persisted HelloWork observation with Electron DETAIL content.
   * @param {import("express").Request} request - Incoming request.
   * @param {import("express").Response} response - Outgoing response.
   * @returns {void}
   */
  enrichOfferContent(request, response) {
    try {
      const id = this.parseOfferId(request.params.id);
      this.offerContentAcquisitionService.enrichHelloWorkDetail(id, request.body);
      const preparation = this.offerPreparationService.prepare(id);
      this.view.renderSuccess(response, this.toPreparationApiJson(preparation));
    } catch (error) {
      const statusCode = error.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR;
      this.view.renderError(response, statusCode, error.message);
    }
  }

  /**
   * Evaluate the preparation state of one authoritative persisted observation.
   * @param {import("express").Request} request - Incoming request.
   * @param {import("express").Response} response - Outgoing response.
   * @returns {void}
   */
  prepareOffer(request, response) {
    try {
      const id = this.parseOfferId(request.params.id);
      const preparation = this.offerPreparationService.prepare(id);
      this.view.renderSuccess(response, this.toPreparationApiJson(preparation));
    } catch (error) {
      const statusCode = error.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR;
      this.view.renderError(response, statusCode, error.message);
    }
  }

  /**
   * Replace explicit user content and return its immediate preparation state.
   * @param {import("express").Request} request - Incoming request.
   * @param {import("express").Response} response - Outgoing response.
   * @returns {void}
   */
  replaceUserContent(request, response) {
    try {
      const id = this.parseOfferId(request.params.id);
      const preparation = this.offerPreparationService.replaceUserText(
        id,
        request.body?.text,
      );
      this.view.renderSuccess(response, this.toPreparationApiJson(preparation));
    } catch (error) {
      const statusCode = error.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR;
      this.view.renderError(response, statusCode, error.message);
    }
  }

  /**
   * Return one cached or newly generated analysis of an authoritative READY offer.
   * @param {import("express").Request} request - Incoming request.
   * @param {import("express").Response} response - Outgoing response.
   * @returns {Promise<void>} Resolves once the response has been rendered.
   */
  async analyseOffer(request, response) {
    try {
      const id = this.parseOfferId(request.params.id);
      const result = await this.offerAnalysisService.analyze(id);
      this.view.renderSuccess(response, this.toAnalysisApiJson(result));
    } catch (error) {
      const mapped = this.mapAnalysisError(error);
      this.view.renderError(
        response,
        mapped.statusCode,
        mapped.message,
        mapped.publicMetadata,
      );
    }
  }

  /**
   * Project one runtime result through the explicit public analysis whitelist.
   * @param {object} result - Validated OfferAnalysisService result.
   * @returns {object} Public analysis response.
   */
  toAnalysisApiJson(result) {
    return {
      analyse: result.analysis.toJson(),
      cacheHit: result.cacheHit,
      analyzer: {
        policyVersion: result.analyzer.policyVersion,
        schemaVersion: result.analyzer.schemaVersion,
      },
      analyzedAt: result.analyzedAt,
    };
  }

  /**
   * Map one expected analysis failure into a safe public HTTP contract.
   * @param {unknown} error - Runtime failure.
   * @returns {{statusCode: number, message: string, publicMetadata: object}} Mapping.
   */
  mapAnalysisError(error) {
    if (error instanceof OfferPreparationError) {
      const notFound = error.statusCode === HttpStatus.NOT_FOUND;
      return this.buildAnalysisErrorMapping(
        notFound ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST,
        notFound ? PUBLIC_ANALYSIS_ERROR.OFFER_NOT_FOUND
          : PUBLIC_ANALYSIS_ERROR.INVALID_OFFER_ID,
        notFound ? "OFFER_NOT_FOUND" : "INVALID_OFFER_ID",
      );
    }
    if (error instanceof OfferAnalysisServiceError) {
      return this.mapAnalysisServiceError(error);
    }
    if (error instanceof OfferAnalyzerError) {
      return this.mapAnalyzerError(error);
    }
    return this.buildAnalysisErrorMapping(
      HttpStatus.INTERNAL_SERVER_ERROR,
      PUBLIC_ANALYSIS_ERROR.INTERNAL_SERVER_ERROR,
      "INTERNAL_SERVER_ERROR",
    );
  }

  /**
   * Map one closed runtime orchestration error.
   * @param {OfferAnalysisServiceError} error - Runtime error.
   * @returns {{statusCode: number, message: string, publicMetadata: object}} Mapping.
   */
  mapAnalysisServiceError(error) {
    if (error.code === OfferAnalysisServiceError.CODE.OFFER_NOT_READY) {
      const publicMetadata = { code: error.code };
      const allowedStatuses = [
        OfferPreparationConstants.STATUS.NEEDS_PROVIDER_ACQUISITION,
        OfferPreparationConstants.STATUS.NEEDS_USER_TEXT,
      ];
      if (allowedStatuses.includes(error.safeDetails.prepareStatus)) {
        publicMetadata.prepareStatus = error.safeDetails.prepareStatus;
      }
      return {
        statusCode: HttpStatus.CONFLICT,
        message: PUBLIC_ANALYSIS_ERROR.OFFER_NOT_READY,
        publicMetadata,
      };
    }
    return this.buildAnalysisErrorMapping(
      HttpStatus.INTERNAL_SERVER_ERROR,
      PUBLIC_ANALYSIS_ERROR.INTERNAL_SERVER_ERROR,
      OfferAnalysisServiceError.CODE.CACHE_PERSISTENCE_ERROR,
    );
  }

  /**
   * Map one closed Analyzer failure without exposing its safeDetails or cause.
   * @param {OfferAnalyzerError} error - Analyzer error.
   * @returns {{statusCode: number, message: string, publicMetadata: object}} Mapping.
   */
  mapAnalyzerError(error) {
    const mappings = {
      [OfferAnalyzerError.CODE.ANALYZER_INPUT_TOO_LARGE]: {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        message: PUBLIC_ANALYSIS_ERROR.ANALYZER_INPUT_TOO_LARGE,
      },
      [OfferAnalyzerError.CODE.ANALYZER_UNAVAILABLE]: {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: PUBLIC_ANALYSIS_ERROR.ANALYZER_UNAVAILABLE,
      },
      [OfferAnalyzerError.CODE.ANALYZER_TIMEOUT]: {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: PUBLIC_ANALYSIS_ERROR.ANALYZER_TIMEOUT,
      },
      [OfferAnalyzerError.CODE.ANALYZER_RATE_LIMITED]: {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: PUBLIC_ANALYSIS_ERROR.ANALYZER_RATE_LIMITED,
      },
      [OfferAnalyzerError.CODE.ANALYZER_PROVIDER_ERROR]: {
        statusCode: HttpStatus.BAD_GATEWAY,
        message: PUBLIC_ANALYSIS_ERROR.ANALYZER_PROVIDER_ERROR,
      },
      [OfferAnalyzerError.CODE.ANALYZER_PROVIDER_TOKEN_BUDGET]: {
        statusCode: HttpStatus.BAD_GATEWAY,
        message: PUBLIC_ANALYSIS_ERROR.ANALYZER_PROVIDER_TOKEN_BUDGET,
      },
      [OfferAnalyzerError.CODE.ANALYZER_INVALID_OUTPUT]: {
        statusCode: HttpStatus.BAD_GATEWAY,
        message: PUBLIC_ANALYSIS_ERROR.ANALYZER_INVALID_OUTPUT,
      },
    };
    const mapped = mappings[error.code];
    if (!mapped) {
      return this.buildAnalysisErrorMapping(
        HttpStatus.BAD_GATEWAY,
        PUBLIC_ANALYSIS_ERROR.ANALYZER_PROVIDER_ERROR,
        OfferAnalyzerError.CODE.ANALYZER_PROVIDER_ERROR,
      );
    }
    return this.buildAnalysisErrorMapping(mapped.statusCode, mapped.message, error.code);
  }

  /**
   * Build one flat JsonView error mapping from controlled constants only.
   * @param {number} statusCode - Public HTTP status.
   * @param {string} message - Safe constant message.
   * @param {string} code - Public closed error code.
   * @returns {{statusCode: number, message: string, publicMetadata: object}} Mapping.
   */
  buildAnalysisErrorMapping(statusCode, message, code) {
    return { statusCode, message, publicMetadata: { code } };
  }

  /**
   * Project a persisted observation for the public API with its internal id.
   * @param {import("../models/JobOffer.js").JobOffer} offer - Persisted observation.
   * @returns {object} Public API representation.
   */
  toApiJson(offer) {
    return {
      id: offer.id,
      ...offer.toJson(),
    };
  }

  /**
   * Project a preparation result without exposing trusted OfferContent internals.
   * @param {object} preparation - Internal preparation result.
   * @returns {object} Public preparation envelope.
   */
  toPreparationApiJson(preparation) {
    return {
      prepareStatus: preparation.prepareStatus,
      evaluation: preparation.evaluation,
      offre: this.toApiJson(preparation.offer),
      userContent: preparation.userContent,
      providerAcquisition: preparation.providerAcquisition,
    };
  }
}

export { OfferController };
