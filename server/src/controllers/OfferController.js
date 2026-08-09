import { SearchCriteria } from "../models/SearchCriteria.js";
import { JobOffer } from "../models/JobOffer.js";
import { HttpStatus } from "../constants/HttpStatus.js";

/**
 * Controller exposing the offer search resource of the API.
 */
class OfferController {
  /**
   * Create the controller with its dependencies.
   * @param {import("../services/OfferSearchService.js").OfferSearchService} offerSearchService - Search service.
   * @param {import("../services/CommuneResolver.js").CommuneResolver} communeResolver - City to INSEE resolver.
   * @param {import("../views/JsonView.js").JsonView} view - JSON view.
   */
  constructor(offerSearchService, communeResolver, view) {
    this.offerSearchService = offerSearchService;
    this.communeResolver = communeResolver;
    this.view = view;
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
          return offer.toJson();
        }),
      });
    } catch (error) {
      this.view.renderError(response, HttpStatus.INTERNAL_SERVER_ERROR, error.message);
    }
  }
}

export { OfferController };
