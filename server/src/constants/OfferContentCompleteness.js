/**
 * Technical completeness levels supported for automatic offer text.
 */
class OfferContentCompleteness {
  static PROVIDER_FULL = "PROVIDER_FULL";

  static UNKNOWN = "UNKNOWN";

  static KNOWN_TRUNCATED = "KNOWN_TRUNCATED";

  /**
   * Tell whether a value is a supported completeness level.
   * @param {unknown} value - The value to validate.
   * @returns {boolean} True when the completeness level is supported.
   */
  static isValid(value) {
    return value === OfferContentCompleteness.PROVIDER_FULL
      || value === OfferContentCompleteness.UNKNOWN
      || value === OfferContentCompleteness.KNOWN_TRUNCATED;
  }
}

export { OfferContentCompleteness };
