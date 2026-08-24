/**
 * Builds closed ApplicationBrief provider diagnostics from sanitized transport details.
 */
class ApplicationBriefProviderDiagnostics {
  /**
   * Copy only the approved nullable typed rate-limit fields.
   * @param {object} [safeDetails] - Existing sanitized Groq transport details.
   * @returns {object} Closed ApplicationBrief rate-limit diagnostic fields.
   */
  static createRateLimitDetails(safeDetails = {}) {
    return {
      rateLimitTokenLimit: this.sanitizeInteger(safeDetails?.rateLimitTokenLimit),
      rateLimitTokenRemaining: this.sanitizeInteger(
        safeDetails?.rateLimitTokenRemaining,
      ),
      rateLimitTokenResetMs: this.sanitizeInteger(safeDetails?.rateLimitTokenResetMs),
      rateLimitRequestLimit: this.sanitizeInteger(safeDetails?.rateLimitRequestLimit),
      rateLimitRequestRemaining: this.sanitizeInteger(
        safeDetails?.rateLimitRequestRemaining,
      ),
      rateLimitRequestResetMs: this.sanitizeInteger(
        safeDetails?.rateLimitRequestResetMs,
      ),
      retryAfterMs: this.sanitizeInteger(safeDetails?.retryAfterMs),
    };
  }

  /**
   * Preserve one already-sanitized non-negative safe integer or close it to null.
   * @param {unknown} value - Typed transport metadata candidate.
   * @returns {number|null} Closed nullable integer.
   */
  static sanitizeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
}

export { ApplicationBriefProviderDiagnostics };
