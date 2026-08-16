/**
 * Stable safe failure raised by CoverLetter generation components.
 */
class CoverLetterGeneratorError extends Error {
  static CODE = Object.freeze({
    INPUT_TOO_LARGE: "COVER_LETTER_INPUT_TOO_LARGE",
    INSUFFICIENT_SUPPORTED_CLAIMS: "INSUFFICIENT_SUPPORTED_CLAIMS",
    UNAVAILABLE: "COVER_LETTER_UNAVAILABLE",
    TIMEOUT: "COVER_LETTER_TIMEOUT",
    RATE_LIMITED: "COVER_LETTER_RATE_LIMITED",
    PROVIDER_TOKEN_BUDGET: "COVER_LETTER_PROVIDER_TOKEN_BUDGET",
    PROVIDER_ERROR: "COVER_LETTER_PROVIDER_ERROR",
    INVALID_OUTPUT: "INVALID_COVER_LETTER_OUTPUT",
  });

  /**
   * Create a generator failure without retaining prompts or generation data.
   * @param {string} code - Stable generator failure code and safe message.
   * @param {Error|null} [cause] - Internal technical cause.
   */
  constructor(code, cause = null) {
    super(code, cause ? { cause } : undefined);
    this.name = "CoverLetterGeneratorError";
    this.code = code;
  }
}

export { CoverLetterGeneratorError };
