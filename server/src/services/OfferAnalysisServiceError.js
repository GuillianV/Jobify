/**
 * Stable runtime failure raised by OfferAnalysisService.
 */
class OfferAnalysisServiceError extends Error {
  static CODE = Object.freeze({
    OFFER_NOT_READY: "OFFER_NOT_READY",
    CACHE_PERSISTENCE_ERROR: "CACHE_PERSISTENCE_ERROR",
  });

  /**
   * Create a safe runtime orchestration error.
   * @param {string} code - Stable service error code and safe message.
   * @param {object} [safeDetails] - Closed non-sensitive diagnostic details.
   * @param {Error|null} [cause] - Internal technical cause.
   */
  constructor(code, safeDetails = {}, cause = null) {
    super(code, cause ? { cause } : undefined);
    this.name = "OfferAnalysisServiceError";
    this.code = code;
    this.safeDetails = structuredClone(safeDetails);
  }
}

export { OfferAnalysisServiceError };
