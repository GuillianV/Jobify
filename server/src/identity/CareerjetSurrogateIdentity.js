import { createHash } from "node:crypto";
import { TextNormalizer } from "../normalization/TextNormalizer.js";

const HASH_ALGORITHM = "sha256";
const HASH_ENCODING = "hex";
const DATE_SEPARATOR = "T";
const DATE_PART_INDEX = 0;

/**
 * Builds the conservative identity signal used for Careerjet observations.
 */
class CareerjetSurrogateIdentity {
  /**
   * Build a surrogate from the five documented provider signals.
   * @param {object} params - Canonical Careerjet offer attributes.
   * @param {unknown} params.title - Job title.
   * @param {unknown} params.company - Company name.
   * @param {unknown} params.city - Most specific city.
   * @param {unknown} params.locationLabel - Provider location label.
   * @param {unknown} params.publishedAt - ISO publication timestamp.
   * @param {unknown} params.description - Plain-text or HTML description.
   * @returns {{surrogateKey: string, surrogateMatchable: boolean}} The surrogate identity.
   */
  static build({ title, company, city, locationLabel, publishedAt, description }) {
    const titleSignal = TextNormalizer.slug(title);
    const companySignal = TextNormalizer.slug(company);
    const locationSignal = TextNormalizer.slug(city || locationLabel);
    const publicationDay = CareerjetSurrogateIdentity.extractPublicationDay(publishedAt);
    const descriptionText = TextNormalizer.htmlToPlainText(description);
    const descriptionSignal = TextNormalizer.normalize(descriptionText);
    const descriptionHash = CareerjetSurrogateIdentity.hash(descriptionSignal);
    const signals = [titleSignal, companySignal, locationSignal, publicationDay, descriptionHash];
    return {
      surrogateKey: CareerjetSurrogateIdentity.hash(JSON.stringify(signals)),
      surrogateMatchable: Boolean(
        titleSignal && companySignal && locationSignal && publicationDay && descriptionSignal,
      ),
    };
  }

  /**
   * Extract a valid UTC calendar day from an ISO timestamp.
   * @param {unknown} value - Candidate ISO timestamp.
   * @returns {string} The UTC day, or an empty string when invalid.
   */
  static extractPublicationDay(value) {
    if (!value) {
      return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toISOString().split(DATE_SEPARATOR)[DATE_PART_INDEX];
  }

  /**
   * Hash a canonical identity signal.
   * @param {string} value - Canonical signal.
   * @returns {string} Lowercase hexadecimal SHA-256 digest.
   */
  static hash(value) {
    return createHash(HASH_ALGORITHM).update(value).digest(HASH_ENCODING);
  }
}

export { CareerjetSurrogateIdentity };
