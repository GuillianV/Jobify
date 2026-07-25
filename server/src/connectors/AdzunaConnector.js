import { JobConnector } from "./JobConnector.js";
import { JobOffer } from "../models/JobOffer.js";
import { Company } from "../models/Company.js";
import { JobLocation } from "../models/JobLocation.js";
import { Salary } from "../models/Salary.js";
import { JobSource } from "../constants/JobSource.js";
import { SalaryPeriod } from "../constants/SalaryPeriod.js";
import { ContractType } from "../constants/ContractType.js";
import { AdzunaConstants } from "../constants/AdzunaConstants.js";
import { ContractTypeNormalizer } from "../normalization/ContractTypeNormalizer.js";
import { DateNormalizer } from "../normalization/DateNormalizer.js";

const COUNTRY_FRANCE = "France";
const LAST_AREA_OFFSET = 1;
const EMPTY_TEXT = "";

/**
 * Connector for the Adzuna job search API (France endpoint). Adzuna exposes
 * structured salary bounds, mapped straight into the canonical Salary.
 */
class AdzunaConnector extends JobConnector {
  /**
   * Create the connector from its API credentials.
   * @param {object} credentials - Adzuna credentials.
   * @param {string} credentials.appId - Adzuna application id.
   * @param {string} credentials.appKey - Adzuna application key.
   */
  constructor(credentials) {
    super();
    this.appId = credentials.appId;
    this.appKey = credentials.appKey;
  }

  /**
   * Return the source identifier produced by this connector.
   * @returns {string} The Adzuna source identifier.
   */
  getSource() {
    return JobSource.ADZUNA;
  }

  /**
   * Tell whether the API credentials are present.
   * @returns {boolean} True when both app id and app key are set.
   */
  isConfigured() {
    return Boolean(this.appId) && Boolean(this.appKey);
  }

  /**
   * Search offers matching the given criteria and map them to JobOffer.
   * @param {import("../models/SearchCriteria.js").SearchCriteria} criteria - Criteria.
   * @returns {Promise<JobOffer[]>} The canonical offers.
   */
  async search(criteria) {
    const url = new URL(AdzunaConstants.SEARCH_ENDPOINT);
    url.searchParams.set("app_id", this.appId);
    url.searchParams.set("app_key", this.appKey);
    url.searchParams.set("what", criteria.keywords);
    if (criteria.location) {
      url.searchParams.set("where", criteria.location);
      url.searchParams.set("distance", String(criteria.distanceKm));
    }
    url.searchParams.set("results_per_page", String(AdzunaConstants.RESULTS_PER_PAGE));
    const response = await fetch(url);
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Adzuna search failed (HTTP ${response.status}): ${detail}`);
    }
    const payload = await response.json();
    const results = payload.results ?? [];
    return results.map((raw) => {
      return this.mapOffer(raw);
    });
  }

  /**
   * Extract the most specific city name from an Adzuna location area array.
   * @param {object} location - The raw Adzuna location object.
   * @returns {string|null} The city name, or null when unavailable.
   */
  extractCity(location) {
    const area = location?.area ?? [];
    if (area.length === 0) {
      return location?.display_name ?? null;
    }
    return area[area.length - LAST_AREA_OFFSET];
  }

  /**
   * Build the canonical salary from Adzuna's numeric bounds.
   * @param {object} raw - The raw Adzuna offer.
   * @returns {Salary} The salary (empty when no bound is provided).
   */
  buildSalary(raw) {
    if (!raw.salary_min && !raw.salary_max) {
      return Salary.fromLabel(null);
    }
    return Salary.fromAmounts(
      raw.salary_min ?? null,
      raw.salary_max ?? null,
      AdzunaConstants.CURRENCY_EUR,
      SalaryPeriod.YEARLY,
    );
  }

  /**
   * Resolve the contract type from Adzuna's structured field, falling back to
   * the title and description when the field is missing.
   * @param {object} raw - The raw Adzuna offer.
   * @returns {string} The canonical contract type.
   */
  resolveContractType(raw) {
    const structured = ContractTypeNormalizer.fromAdzuna(raw.contract_type);
    if (structured !== ContractType.OTHER) {
      return structured;
    }
    return ContractTypeNormalizer.fromLabel(`${raw.title} ${raw.description ?? EMPTY_TEXT}`);
  }

  /**
   * Map a single raw Adzuna offer to the canonical JobOffer model.
   * @param {object} raw - The raw offer object from the API.
   * @returns {JobOffer} The canonical offer.
   */
  mapOffer(raw) {
    const location = raw.location ?? {};
    const company = raw.company ?? {};
    return new JobOffer({
      source: JobSource.ADZUNA,
      sourceId: String(raw.id),
      title: raw.title,
      description: raw.description ?? null,
      company: new Company({ name: company.display_name ?? null }),
      location: new JobLocation({
        label: location.display_name ?? null,
        city: this.extractCity(location),
        latitude: raw.latitude ?? null,
        longitude: raw.longitude ?? null,
        country: COUNTRY_FRANCE,
      }),
      contractType: this.resolveContractType(raw),
      contractTypeLabel: raw.contract_type ?? null,
      salary: this.buildSalary(raw),
      applyUrl: raw.redirect_url ?? null,
      publishedAt: DateNormalizer.toIso(raw.created),
    });
  }
}

export { AdzunaConnector };
