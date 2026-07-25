import { GeoConstants } from "../constants/GeoConstants.js";
import { TextNormalizer } from "../normalization/TextNormalizer.js";

const NO_MATCH = 0;
const FIRST_MATCH_INDEX = 0;

/**
 * Resolves a free-text city name into an INSEE commune code using the free
 * geo.api.gouv.fr service. Results are cached in memory for the process
 * lifetime. This lets France Travail (which filters by INSEE code) benefit from
 * the same location as the text-based aggregators.
 */
class CommuneResolver {
  /**
   * Create the resolver with an empty cache.
   */
  constructor() {
    this.cache = new Map();
  }

  /**
   * Resolve a city name to its INSEE code, or null when it cannot be resolved.
   * @param {string|null|undefined} cityName - The free-text city name.
   * @returns {Promise<string|null>} The INSEE code, or null.
   */
  async resolve(cityName) {
    if (!cityName) {
      return null;
    }
    const key = TextNormalizer.normalize(cityName);
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }
    const code = await this.fetchCode(cityName);
    this.cache.set(key, code);
    return code;
  }

  /**
   * Query geo.api.gouv.fr for the most populated commune matching the name.
   * @param {string} cityName - The city name to look up.
   * @returns {Promise<string|null>} The INSEE code, or null on failure.
   */
  async fetchCode(cityName) {
    const url = new URL(GeoConstants.COMMUNES_ENDPOINT);
    url.searchParams.set("nom", cityName);
    url.searchParams.set("fields", "code");
    url.searchParams.set("boost", "population");
    url.searchParams.set("limit", String(GeoConstants.RESULT_LIMIT));
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }
      const communes = await response.json();
      if (communes.length === NO_MATCH) {
        return null;
      }
      return communes[FIRST_MATCH_INDEX].code;
    } catch (error) {
      console.warn(`Commune resolution failed for "${cityName}": ${error.message}`);
      return null;
    }
  }
}

export { CommuneResolver };
