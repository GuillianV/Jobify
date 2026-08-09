/**
 * Identity strategies supported for provider observations.
 */
class OfferIdentityKind {
  static STABLE = "STABLE";

  static SURROGATE = "SURROGATE";

  /**
   * Tell whether a value is a supported identity strategy.
   * @param {unknown} value - The value to validate.
   * @returns {boolean} True when the identity strategy is supported.
   */
  static isValid(value) {
    return value === OfferIdentityKind.STABLE || value === OfferIdentityKind.SURROGATE;
  }
}

export { OfferIdentityKind };
