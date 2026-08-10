import { DeduplicationConstants } from "../constants/DeduplicationConstants.js";
import { TextNormalizer } from "../normalization/TextNormalizer.js";

const NON_ALPHANUMERIC_PATTERN = /[^a-z0-9]+/gu;

/**
 * Corroborates cross-city duplicates through audited near-token containment.
 */
class StrongDescriptionContainment {
  /**
   * Test whether the smaller description is almost fully contained in the larger.
   * @param {unknown} firstDescription - First automatic description.
   * @param {unknown} secondDescription - Second automatic description.
   * @returns {boolean} True when the audited conservative rule is satisfied.
   */
  matches(firstDescription, secondDescription) {
    const firstTokens = this.buildTokenSet(firstDescription);
    const secondTokens = this.buildTokenSet(secondDescription);
    const smaller = firstTokens.size <= secondTokens.size ? firstTokens : secondTokens;
    const larger = smaller === firstTokens ? secondTokens : firstTokens;
    if (smaller.size < DeduplicationConstants.MIN_DESCRIPTION_DISTINCT_TOKENS) {
      return false;
    }
    let missing = 0;
    for (const token of smaller) {
      if (!larger.has(token)) {
        missing += 1;
      }
      if (missing > DeduplicationConstants.MAX_MISSING_DESCRIPTION_TOKENS) {
        return false;
      }
    }
    return true;
  }

  /**
   * Build distinct normalized alphanumeric tokens from one description.
   * @param {unknown} description - Description text.
   * @returns {Set<string>} Distinct tokens.
   */
  buildTokenSet(description) {
    const normalized = TextNormalizer.normalize(description)
      .replace(NON_ALPHANUMERIC_PATTERN, " ")
      .trim();
    return new Set(normalized ? normalized.split(" ") : []);
  }
}

export { StrongDescriptionContainment };
