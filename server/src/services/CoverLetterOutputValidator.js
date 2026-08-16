import { CoverLetterLimits } from "../constants/CoverLetterLimits.js";
import { CoverLetter } from "../models/CoverLetter.js";

const OUTPUT_KEYS = Object.freeze(["letter", "usedClaimIndexes"]);

/**
 * Validates the strict provider output contract for one CoverLetter V1.
 */
class CoverLetterOutputValidator {
  /**
   * Validate generated output without repair and materialize its domain value.
   * @param {unknown} candidate - Untrusted generated output.
   * @returns {CoverLetter} Detached immutable cover letter.
   */
  validate(candidate) {
    this.requireExactObject(candidate);
    this.validateLetter(candidate.letter);
    this.validateUsedClaimIndexes(candidate.usedClaimIndexes);
    return new CoverLetter(candidate);
  }

  /**
   * Require one plain object with the exact provider-output keys.
   * @param {unknown} candidate - Output candidate.
   * @returns {void}
   */
  requireExactObject(candidate) {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)
      || Object.getPrototypeOf(candidate) !== Object.prototype) {
      this.fail("Cover letter output must be a plain object");
    }
    const keys = Object.keys(candidate);
    if (keys.length !== OUTPUT_KEYS.length || keys.some((key) => {
      return !OUTPUT_KEYS.includes(key);
    })) {
      this.fail("Cover letter output keys are invalid");
    }
  }

  /**
   * Require one exact bounded non-blank letter string without rewriting it.
   * @param {unknown} letter - Letter candidate.
   * @returns {void}
   */
  validateLetter(letter) {
    if (typeof letter !== "string" || !letter.trim()
      || letter.length < CoverLetterLimits.MINIMUM_LETTER_LENGTH
      || letter.length > CoverLetterLimits.MAXIMUM_LETTER_LENGTH) {
      this.fail("Cover letter text is invalid");
    }
  }

  /**
   * Require bounded unique non-negative safe claim indexes in caller order.
   * @param {unknown} indexes - Used claim indexes candidate.
   * @returns {void}
   */
  validateUsedClaimIndexes(indexes) {
    if (!Array.isArray(indexes) || indexes.length === 0
      || indexes.length > CoverLetterLimits.MAXIMUM_USED_CLAIM_INDEXES) {
      this.fail("Used claim indexes are invalid");
    }
    const unique = new Set();
    for (const index of indexes) {
      if (!Number.isSafeInteger(index) || index < 0 || unique.has(index)) {
        this.fail("Used claim index is invalid");
      }
      unique.add(index);
    }
  }

  /**
   * Reject one invalid generated output without normalizing it.
   * @param {string} message - Stable internal validation description.
   * @returns {never}
   */
  fail(message) {
    throw new TypeError(message);
  }
}

export { CoverLetterOutputValidator };
