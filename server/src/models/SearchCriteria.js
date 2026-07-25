import { SearchDefaults } from "../constants/SearchDefaults.js";

/**
 * Search criteria shared by every job connector. It carries both the INSEE
 * commune code (used by France Travail) and a free-text location (used by the
 * aggregators such as Adzuna and Careerjet).
 */
class SearchCriteria {
  /**
   * Create search criteria, applying defaults for missing values.
   * @param {object} params - Search parameters.
   * @param {string} params.keywords - Free-text keywords.
   * @param {string|null} [params.communeInsee] - INSEE code of the commune.
   * @param {string|null} [params.location] - Free-text location (city name).
   * @param {number} [params.distanceKm] - Search radius in kilometers.
   */
  constructor({
    keywords,
    communeInsee = null,
    location = null,
    distanceKm = SearchDefaults.DEFAULT_DISTANCE_KM,
  }) {
    this.keywords = keywords;
    this.communeInsee = communeInsee;
    this.location = location;
    this.distanceKm = distanceKm;
  }
}

export { SearchCriteria };
