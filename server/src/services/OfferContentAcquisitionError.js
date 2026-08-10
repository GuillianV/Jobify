/**
 * Expected acquisition failure carrying the HTTP status exposed by the API.
 */
class OfferContentAcquisitionError extends Error {
  /**
   * Create an expected acquisition error.
   * @param {string} message - Public failure description.
   * @param {number} statusCode - HTTP response status.
   */
  constructor(message, statusCode) {
    super(message);
    this.name = "OfferContentAcquisitionError";
    this.statusCode = statusCode;
  }
}

export { OfferContentAcquisitionError };
