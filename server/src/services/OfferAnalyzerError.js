/**
 * Stable internal failure raised by OfferAnalyzerService.
 */
class OfferAnalyzerError extends Error {
  static CODE = Object.freeze({
    INVALID_OFFER_ID: "INVALID_OFFER_ID",
    OFFER_NOT_FOUND: "OFFER_NOT_FOUND",
    OFFER_NOT_READY: "OFFER_NOT_READY",
    ANALYZER_UNAVAILABLE: "ANALYZER_UNAVAILABLE",
    ANALYZER_TIMEOUT: "ANALYZER_TIMEOUT",
    ANALYZER_RATE_LIMITED: "ANALYZER_RATE_LIMITED",
    ANALYZER_PROVIDER_ERROR: "ANALYZER_PROVIDER_ERROR",
    ANALYZER_INVALID_OUTPUT: "ANALYZER_INVALID_OUTPUT",
    ANALYZER_INPUT_TOO_LARGE: "ANALYZER_INPUT_TOO_LARGE",
  });

  /**
   * Create an analyzer failure without retaining offer or provider content.
   * @param {string} code - Stable analyzer code and safe message.
   * @param {object} [safeDetails] - Non-sensitive diagnostic details.
   * @param {Error|null} [cause] - Internal technical cause.
   */
  constructor(code, safeDetails = {}, cause = null) {
    super(code, cause ? { cause } : undefined);
    this.name = "OfferAnalyzerError";
    this.code = code;
    this.safeDetails = structuredClone(safeDetails);
  }
}

export { OfferAnalyzerError };
