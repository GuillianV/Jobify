/**
 * Safe transport error emitted by GroqJsonClient.
 */
class GroqJsonClientError extends Error {
  static CODE = Object.freeze({
    UNAVAILABLE: "GROQ_UNAVAILABLE",
    TIMEOUT: "GROQ_TIMEOUT",
    RATE_LIMITED: "GROQ_RATE_LIMITED",
    AUTHENTICATION_ERROR: "GROQ_AUTHENTICATION_ERROR",
    TOKEN_BUDGET_EXCEEDED: "GROQ_TOKEN_BUDGET_EXCEEDED",
    HTTP_ERROR: "GROQ_HTTP_ERROR",
    INVALID_RESPONSE: "GROQ_INVALID_RESPONSE",
  });

  /**
   * Create a transport error without retaining request or response content.
   * @param {string} code - Stable transport error code.
   * @param {object} [safeDetails] - Non-sensitive diagnostic details.
   * @param {Error|null} [cause] - Internal technical cause.
   */
  constructor(code, safeDetails = {}, cause = null) {
    super(code, cause ? { cause } : undefined);
    this.name = "GroqJsonClientError";
    this.code = code;
    this.safeDetails = structuredClone(safeDetails);
  }
}

export { GroqJsonClientError };
