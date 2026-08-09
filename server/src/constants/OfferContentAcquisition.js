/**
 * Acquisition channels supported for offer content.
 */
class OfferContentAcquisition {
  static SEARCH = "SEARCH";

  static DETAIL = "DETAIL";

  /**
   * Tell whether a value is a supported acquisition channel.
   * @param {unknown} value - The value to validate.
   * @returns {boolean} True when the acquisition channel is supported.
   */
  static isValid(value) {
    return value === OfferContentAcquisition.SEARCH
      || value === OfferContentAcquisition.DETAIL;
  }
}

export { OfferContentAcquisition };
