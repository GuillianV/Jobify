import { RecencyConstants } from "../constants/RecencyConstants.js";

/**
 * Orchestrates the configured connectors: runs them in parallel, tolerates
 * individual failures, deduplicates the merged offers (exact then semantic),
 * keeps only recent offers and sorts them by publication date.
 */
class OfferSearchService {
  /**
   * Create the service with the connectors it should query and the semantic
   * refiner (dedup + relevance) applied after the exact deduplication.
   * @param {import("../connectors/JobConnector.js").JobConnector[]} connectors - Connectors.
   * @param {import("./SemanticRefiner.js").SemanticRefiner} semanticRefiner - Semantic refiner.
   * @param {import("../persistence/OfferRepository.js").OfferRepository} offerRepository - Offer store.
   * @param {import("./OfferRepresentativePolicy.js").getEligibleRepresentatives} getEligibleRepresentatives - Representative eligibility policy.
   */
  constructor(connectors, semanticRefiner, offerRepository, getEligibleRepresentatives) {
    this.connectors = connectors;
    this.semanticRefiner = semanticRefiner;
    this.offerRepository = offerRepository;
    this.getEligibleRepresentatives = getEligibleRepresentatives;
  }

  /**
   * Query every configured connector, merge in any client-provided offers
   * (scraped on the user's machine), and return the recent, deduplicated,
   * date-sorted offers.
   * @param {import("../models/SearchCriteria.js").SearchCriteria} criteria - Criteria.
   * @param {import("../models/JobOffer.js").JobOffer[]} [injectedOffers] - Client-scraped offers.
   * @returns {Promise<import("../models/JobOffer.js").JobOffer[]>} The offers.
   */
  async search(criteria, injectedOffers = []) {
    const active = this.connectors.filter((connector) => {
      return connector.isConfigured();
    });
    const batches = await Promise.all(
      active.map((connector) => {
        return this.searchConnector(connector, criteria);
      }),
    );
    const merged = [...batches.flat(), ...injectedOffers];
    const recent = this.filterByRecency(merged);
    const persisted = this.offerRepository.upsertMany(recent);
    const unique = this.deduplicate(persisted);
    const refined = await this.semanticRefiner.refine(unique, criteria);
    return this.sortByRecency(refined);
  }

  /**
   * Keep only offers published within the recency window. Offers whose
   * publication date is unknown are kept, to avoid discarding good matches
   * merely because a source omitted the date.
   * @param {import("../models/JobOffer.js").JobOffer[]} offers - Offers to filter.
   * @returns {import("../models/JobOffer.js").JobOffer[]} The recent offers.
   */
  filterByRecency(offers) {
    const maxAgeMs = RecencyConstants.MAX_AGE_DAYS * RecencyConstants.MILLISECONDS_PER_DAY;
    const threshold = Date.now() - maxAgeMs;
    return offers.filter((offer) => {
      if (!offer.publishedAt) {
        return true;
      }
      const publishedTime = Date.parse(offer.publishedAt);
      if (Number.isNaN(publishedTime)) {
        return true;
      }
      return publishedTime >= threshold;
    });
  }

  /**
   * Sort offers by publication date, most recent first. Offers without a
   * known publication date are placed last. The comparison relies on ISO
   * date strings, whose lexicographic order matches chronological order.
   * @param {import("../models/JobOffer.js").JobOffer[]} offers - Offers to sort.
   * @returns {import("../models/JobOffer.js").JobOffer[]} The sorted offers.
   */
  sortByRecency(offers) {
    return [...offers].sort((first, second) => {
      const firstKey = first.publishedAt ?? "";
      const secondKey = second.publishedAt ?? "";
      if (firstKey === secondKey) {
        return 0;
      }
      if (firstKey > secondKey) {
        return -1;
      }
      return 1;
    });
  }

  /**
   * Query a single connector, returning an empty list on failure so that one
   * broken source never breaks the whole search.
   * @param {import("../connectors/JobConnector.js").JobConnector} connector - Connector.
   * @param {import("../models/SearchCriteria.js").SearchCriteria} criteria - Criteria.
   * @returns {Promise<import("../models/JobOffer.js").JobOffer[]>} The offers.
   */
  async searchConnector(connector, criteria) {
    try {
      return await connector.search(criteria);
    } catch (error) {
      console.warn(`Connector ${connector.getSource()} failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Remove duplicate offers, keeping the first occurrence of each key.
   * @param {import("../models/JobOffer.js").JobOffer[]} offers - Offers to filter.
   * @returns {import("../models/JobOffer.js").JobOffer[]} The unique offers.
   */
  deduplicate(offers) {
    const groupsByKey = new Map();
    for (const offer of offers) {
      const key = offer.getDeduplicationKey();
      if (!groupsByKey.has(key)) {
        groupsByKey.set(key, []);
      }
      groupsByKey.get(key).push(offer);
    }
    return [...groupsByKey.values()].map((candidates) => {
      return this.getEligibleRepresentatives(candidates)[0];
    });
  }
}

export { OfferSearchService };
