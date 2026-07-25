import { SearchDefaults } from "../constants/SearchDefaults.js";

/**
 * A saved search the user wants to be watched over time (the basis for
 * scheduled background searches and new-offer notifications).
 */
class SearchProfile {
  /**
   * Create a search profile.
   * @param {object} params - Profile attributes.
   * @param {number|null} [params.id] - Database identifier (null until saved).
   * @param {string} params.label - Human readable name of the saved search.
   * @param {string} params.keywords - Searched keywords.
   * @param {string|null} [params.city] - Searched city.
   * @param {number} [params.distanceKm] - Search radius in kilometers.
   * @param {string|null} [params.createdAt] - Creation timestamp (ISO string).
   */
  constructor({
    id = null,
    label,
    keywords,
    city = null,
    distanceKm = SearchDefaults.DEFAULT_DISTANCE_KM,
    createdAt = null,
  }) {
    this.id = id;
    this.label = label;
    this.keywords = keywords;
    this.city = city;
    this.distanceKm = distanceKm;
    this.createdAt = createdAt;
  }

  /**
   * Serialize the profile to a plain object.
   * @returns {object} The serialized profile.
   */
  toJson() {
    return {
      id: this.id,
      label: this.label,
      keywords: this.keywords,
      city: this.city,
      distanceKm: this.distanceKm,
      createdAt: this.createdAt,
    };
  }
}

export { SearchProfile };
