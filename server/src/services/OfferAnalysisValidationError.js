/**
 * Signals that an untrusted candidate violates the OfferAnalysis V1 contract.
 */
class OfferAnalysisValidationError extends TypeError {
  /**
   * Create a validation error containing only a stable non-sensitive message.
   * @param {string} message - Contract violation description.
   */
  constructor(message) {
    super(message);
    this.name = "OfferAnalysisValidationError";
  }
}

export { OfferAnalysisValidationError };
