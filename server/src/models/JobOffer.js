import { TextNormalizer } from "../normalization/TextNormalizer.js";
import { Company } from "./Company.js";
import { JobLocation } from "./JobLocation.js";
import { Salary } from "./Salary.js";

const KEY_SEPARATOR = "|";

/**
 * Canonical representation of a job offer, shared by every source connector.
 */
class JobOffer {
  /**
   * Create a canonical offer.
   * @param {object} params - Offer attributes.
   * @param {string} params.source - Source identifier (see JobSource).
   * @param {string} params.sourceId - Identifier of the offer within its source.
   * @param {string} params.title - Job title.
   * @param {string|null} [params.description] - Full description.
   * @param {import("./Company.js").Company} params.company - Hiring company.
   * @param {import("./JobLocation.js").JobLocation} params.location - Location.
   * @param {string} [params.contractType] - Canonical contract type (ContractType).
   * @param {string|null} [params.contractTypeLabel] - Original source contract label.
   * @param {import("./Salary.js").Salary} params.salary - Compensation.
   * @param {string|null} [params.applyUrl] - URL where the human can apply.
   * @param {string|null} [params.publishedAt] - Publication date (ISO string).
   * @param {object[]} [params.alternates] - Same offer seen on other sources.
   */
  constructor({
    source,
    sourceId,
    title,
    description = null,
    company,
    location,
    contractType,
    contractTypeLabel = null,
    salary,
    applyUrl = null,
    publishedAt = null,
    alternates = [],
  }) {
    this.source = source;
    this.sourceId = sourceId;
    this.title = title;
    this.description = description;
    this.company = company;
    this.location = location;
    this.contractType = contractType;
    this.contractTypeLabel = contractTypeLabel;
    this.salary = salary;
    this.applyUrl = applyUrl;
    this.publishedAt = publishedAt;
    this.alternates = alternates;
  }

  /**
   * Rebuild a JobOffer (and its value objects) from a serialized payload, as
   * produced by toJson. Used to ingest client-scraped offers and to reload
   * offers persisted in the database.
   * @param {object} json - The serialized offer.
   * @returns {JobOffer} The reconstructed offer.
   */
  static fromJson(json) {
    return new JobOffer({
      source: json.source,
      sourceId: json.sourceId,
      title: json.title,
      description: json.description ?? null,
      company: new Company(json.company ?? {}),
      location: new JobLocation(json.location ?? {}),
      contractType: json.contractType,
      contractTypeLabel: json.contractTypeLabel ?? null,
      salary: new Salary(json.salary ?? {}),
      applyUrl: json.applyUrl ?? null,
      publishedAt: json.publishedAt ?? null,
      alternates: json.alternates ?? [],
    });
  }

  /**
   * Record another source that was found to describe this same offer, so the
   * user keeps every apply link even after duplicates are merged.
   * @param {JobOffer} offer - The duplicate offer from another source.
   * @returns {void}
   */
  addAlternate(offer) {
    this.alternates.push({
      source: offer.source,
      applyUrl: offer.applyUrl,
    });
  }

  /**
   * Build a stable, normalization-robust key used to deduplicate the same offer
   * across sources (accents, casing and punctuation are stripped).
   * @returns {string} A normalized key from title, company and city.
   */
  getDeduplicationKey() {
    const titleSlug = TextNormalizer.slug(this.title);
    const companySlug = TextNormalizer.slug(this.company?.name);
    const citySlug = TextNormalizer.slug(this.location?.city);
    return [titleSlug, companySlug, citySlug].join(KEY_SEPARATOR);
  }

  /**
   * Serialize the offer and its nested value objects to a plain object.
   * @returns {object} The serialized offer.
   */
  toJson() {
    return {
      source: this.source,
      sourceId: this.sourceId,
      title: this.title,
      description: this.description,
      company: this.company ? this.company.toJson() : null,
      location: this.location ? this.location.toJson() : null,
      contractType: this.contractType,
      contractTypeLabel: this.contractTypeLabel,
      salary: this.salary ? this.salary.toJson() : null,
      applyUrl: this.applyUrl,
      publishedAt: this.publishedAt,
      alternates: this.alternates,
    };
  }
}

export { JobOffer };
