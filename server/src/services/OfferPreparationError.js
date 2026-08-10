/**
 * Expected preparation failure carrying the HTTP status exposed by the API.
 */
class OfferPreparationError extends Error {
  /**
   * Create an expected preparation error.
   * @param {string} message - Public failure description.
   * @param {number} statusCode - HTTP response status.
   */
  constructor(message, statusCode) {
    super(message);
    this.name = "OfferPreparationError";
    this.statusCode = statusCode;
  }
}

export { OfferPreparationError };
