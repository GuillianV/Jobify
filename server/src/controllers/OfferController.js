import { SearchCriteria } from "../models/SearchCriteria.js";
import { JobOffer } from "../models/JobOffer.js";
import { HttpStatus } from "../constants/HttpStatus.js";
import { OfferPreparationError } from "../services/OfferPreparationError.js";

const CANONICAL_OFFER_ID_PATTERN = /^[1-9]\d*$/u;

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
   */
  constructor(
    offerSearchService,
    communeResolver,
    view,
    offerContentAcquisitionService,
    offerPreparationService,
  ) {
    this.offerSearchService = offerSearchService;
    this.communeResolver = communeResolver;
    this.view = view;
    this.offerContentAcquisitionService = offerContentAcquisitionService;
    this.offerPreparationService = offerPreparationService;
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
