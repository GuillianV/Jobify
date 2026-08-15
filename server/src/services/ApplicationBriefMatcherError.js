/**
 * Stable safe failure raised by ApplicationBrief semantic matching components.
 */
class ApplicationBriefMatcherError extends Error {
  static CODE = Object.freeze({
    INVALID_OUTPUT: "INVALID_APPLICATION_BRIEF_OUTPUT",
    INPUT_TOO_LARGE: "APPLICATION_BRIEF_INPUT_TOO_LARGE",
    UNAVAILABLE: "APPLICATION_BRIEF_UNAVAILABLE",
    TIMEOUT: "APPLICATION_BRIEF_TIMEOUT",
    RATE_LIMITED: "APPLICATION_BRIEF_RATE_LIMITED",
    PROVIDER_TOKEN_BUDGET: "APPLICATION_BRIEF_PROVIDER_TOKEN_BUDGET",
    PROVIDER_ERROR: "APPLICATION_BRIEF_PROVIDER_ERROR",
  });

  static REASON = Object.freeze({
    INVALID_SEMANTIC_OUTPUT: "INVALID_SEMANTIC_OUTPUT",
    INVALID_CONTEXTUAL_OUTPUT: "INVALID_CONTEXTUAL_OUTPUT",
  });

  /**
   * Create a matcher failure without retaining prompt or candidate content.
   * @param {string} code - Stable matcher failure code and safe message.
   * @param {string|null} [reason] - Closed internal reason when applicable.
   * @param {Error|null} [cause] - Internal technical cause.
   */
  constructor(code, reason = null, cause = null) {
    super(code, cause ? { cause } : undefined);
    this.name = "ApplicationBriefMatcherError";
    this.code = code;
    this.reason = reason;
  }
}

export { ApplicationBriefMatcherError };
