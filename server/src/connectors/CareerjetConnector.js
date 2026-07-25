import { JobConnector } from "./JobConnector.js";
import { JobOffer } from "../models/JobOffer.js";
import { Company } from "../models/Company.js";
import { JobLocation } from "../models/JobLocation.js";
import { Salary } from "../models/Salary.js";
import { JobSource } from "../constants/JobSource.js";
import { CareerjetConstants } from "../constants/CareerjetConstants.js";
import { TextNormalizer } from "../normalization/TextNormalizer.js";
import { ContractTypeNormalizer } from "../normalization/ContractTypeNormalizer.js";
import { DateNormalizer } from "../normalization/DateNormalizer.js";

const COUNTRY_FRANCE = "France";
const CITY_SEPARATOR = ",";
const FIRST_PART_INDEX = 0;
const TITLE_DESCRIPTION_SEPARATOR = " ";

/**
 * Connector for the public Careerjet API (which also powers Optioncarriere in
 * France). The API is served over HTTP and needs a Referer header; keywords are
 * normalized because tokens such as "node.js" return nothing otherwise.
 */
class CareerjetConnector extends JobConnector {
  /**
   * Create the connector from its affiliate id.
   * @param {object} credentials - Careerjet credentials.
   * @param {string} credentials.affid - Careerjet affiliate id.
   */
  constructor(credentials) {
    super();
    this.affid = credentials.affid;
  }

  /**
   * Return the source identifier produced by this connector.
   * @returns {string} The Careerjet source identifier.
   */
  getSource() {
    return JobSource.CAREERJET;
  }

  /**
   * Tell whether the affiliate id is present.
   * @returns {boolean} True when the affiliate id is set.
   */
  isConfigured() {
    return Boolean(this.affid);
  }

  /**
   * Search offers matching the given criteria and map them to JobOffer.
   * @param {import("../models/SearchCriteria.js").SearchCriteria} criteria - Criteria.
   * @returns {Promise<JobOffer[]>} The canonical offers.
   */
  async search(criteria) {
    const url = new URL(CareerjetConstants.SEARCH_ENDPOINT);
    url.searchParams.set("locale_code", CareerjetConstants.LOCALE_CODE);
    url.searchParams.set("keywords", TextNormalizer.normalizeKeywords(criteria.keywords));
    if (criteria.location) {
      url.searchParams.set("location", criteria.location);
    }
    url.searchParams.set("affid", this.affid);
    url.searchParams.set("pagesize", String(CareerjetConstants.PAGE_SIZE));
    url.searchParams.set("user_ip", CareerjetConstants.USER_IP);
    url.searchParams.set("user_agent", CareerjetConstants.USER_AGENT);
    const response = await fetch(url, {
      headers: {
        Referer: CareerjetConstants.REFERER,
        "User-Agent": CareerjetConstants.USER_AGENT,
      },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Careerjet search failed (HTTP ${response.status}): ${detail}`);
    }
    const payload = await response.json();
    if (payload.type === CareerjetConstants.ERROR_TYPE) {
      throw new Error(`Careerjet returned an error: ${payload.error}`);
    }
    const jobs = payload.jobs ?? [];
    return jobs.map((raw) => {
      return this.mapOffer(raw);
    });
  }

  /**
   * Extract the city from a Careerjet locations string ("Annecy, Haute-Savoie").
   * @param {string|null|undefined} locations - The raw locations string.
   * @returns {string|null} The city name, or null when unavailable.
   */
  extractCity(locations) {
    if (!locations) {
      return null;
    }
    return locations.split(CITY_SEPARATOR)[FIRST_PART_INDEX].trim();
  }

  /**
   * Map a single raw Careerjet offer to the canonical JobOffer model.
   * @param {object} raw - The raw offer object from the API.
   * @returns {JobOffer} The canonical offer.
   */
  mapOffer(raw) {
    const contractText = [raw.title, raw.description].join(TITLE_DESCRIPTION_SEPARATOR);
    return new JobOffer({
      source: JobSource.CAREERJET,
      sourceId: raw.url,
      title: raw.title,
      description: raw.description ?? null,
      company: new Company({ name: raw.company ?? null }),
      location: new JobLocation({
        label: raw.locations ?? null,
        city: this.extractCity(raw.locations),
        country: COUNTRY_FRANCE,
      }),
      contractType: ContractTypeNormalizer.fromLabel(contractText),
      contractTypeLabel: null,
      salary: Salary.fromLabel(raw.salary ?? null),
      applyUrl: raw.url ?? null,
      publishedAt: DateNormalizer.toIso(raw.date),
    });
  }
}

export { CareerjetConnector };
