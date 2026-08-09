import { TextNormalizer } from "../normalization/TextNormalizer.js";
import { OfferIdentityKind } from "../constants/OfferIdentityKind.js";
import { JobSource } from "../constants/JobSource.js";
import { OfferContentAcquisition } from "../constants/OfferContentAcquisition.js";
import { OfferContentCompleteness } from "../constants/OfferContentCompleteness.js";
import { Company } from "./Company.js";
import { JobLocation } from "./JobLocation.js";
import { OfferContent } from "./OfferContent.js";
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
   * @param {number|null} [params.id] - Internal Jobify identifier.
   * @param {string|null} [params.sourceId] - Identifier of the offer within its source.
   * @param {string} [params.identityKind] - Provider identity strategy.
   * @param {string|null} [params.surrogateKey] - Conservative provider fingerprint.
   * @param {boolean} [params.surrogateMatchable] - Whether the surrogate can match observations.
   * @param {string} params.title - Job title.
   * @param {string|null} [params.description] - Full description.
   * @param {OfferContent|object|null} [params.offerContent] - Trusted persistent content.
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
    id = null,
    source,
    sourceId = null,
    identityKind = OfferIdentityKind.STABLE,
    surrogateKey = null,
    surrogateMatchable = false,
    title,
    description = null,
    offerContent = null,
    company,
    location,
    contractType,
    contractTypeLabel = null,
    salary,
    applyUrl = null,
    publishedAt = null,
    alternates = [],
  }) {
    if (!OfferIdentityKind.isValid(identityKind)) {
      throw new TypeError(`Unsupported offer identity kind: ${identityKind}`);
    }
    this.id = id;
    this.source = source;
    this.sourceId = sourceId;
    this.identityKind = identityKind;
    this.surrogateKey = surrogateKey;
    this.surrogateMatchable = surrogateMatchable;
    this.title = title;
    this.offerContent = offerContent instanceof OfferContent
      ? offerContent
      : offerContent
        ? OfferContent.fromPersistence(offerContent)
        : JobOffer.buildLegacyOfferContent(source, description);
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
      sourceId: json.sourceId ?? null,
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
   * Rebuild a persisted JobOffer using the database id as the source of truth.
   * @param {number} id - Internal identifier read from SQLite.
   * @param {object} payload - Serialized offer payload.
   * @returns {JobOffer} The persisted offer.
   */
  static fromPersistence(id, payload) {
    const offer = JobOffer.fromJson(payload);
    const hasPersistentContent = Object.hasOwn(payload, "offerContent");
    return new JobOffer({
      ...offer,
      id,
      identityKind: payload.identityKind ?? OfferIdentityKind.STABLE,
      surrogateKey: payload.surrogateKey ?? null,
      surrogateMatchable: payload.surrogateMatchable ?? false,
      offerContent: hasPersistentContent
        ? OfferContent.fromPersistence(payload.offerContent)
        : JobOffer.buildLegacyOfferContent(payload.source, payload.description),
    });
  }

  /**
   * Adapt a historical provider description into trusted in-memory content.
   * @param {string} source - Provider source.
   * @param {unknown} description - Historical provider description.
   * @returns {OfferContent} Backward-compatible content.
   */
  static buildLegacyOfferContent(source, description) {
    if (!OfferContent.hasUsefulText(description)) {
      return new OfferContent();
    }
    return new OfferContent({
      automaticText: {
        value: description,
        acquisition: OfferContentAcquisition.SEARCH,
        retrievedAt: null,
        completeness: JobOffer.getLegacyCompleteness(source),
      },
    });
  }

  /**
   * Resolve the demonstrated completeness policy for historical descriptions.
   * @param {string} source - Provider source.
   * @returns {string} Technical completeness level.
   */
  static getLegacyCompleteness(source) {
    if (source === JobSource.FRANCE_TRAVAIL) {
      return OfferContentCompleteness.PROVIDER_FULL;
    }
    if (source === JobSource.ADZUNA || source === JobSource.CAREERJET) {
      return OfferContentCompleteness.KNOWN_TRUNCATED;
    }
    return OfferContentCompleteness.UNKNOWN;
  }

  /**
   * Return the historical public provider description projection.
   * @returns {string|null} The automatic provider text or null.
   */
  get description() {
    return this.offerContent.getAutomaticText();
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
      identityKind: this.identityKind,
      surrogateKey: this.surrogateKey,
      surrogateMatchable: this.surrogateMatchable,
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

  /**
   * Serialize the complete trusted observation for SQLite persistence.
   * @returns {object} The persistent observation payload without SQLite id.
   */
  toPersistenceJson() {
    return {
      ...this.toJson(),
      offerContent: this.offerContent.toPersistenceJson(),
    };
  }
}

export { JobOffer };
