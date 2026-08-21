/**
 * Stable internal failure raised by the CoverLetter service trust boundary.
 */
class CoverLetterServiceError extends Error {
  static CODE = Object.freeze({
    INVALID_REQUEST: "INVALID_REQUEST",
    REQUEST_TOO_LARGE: "REQUEST_TOO_LARGE",
    REFRESH_REQUIRED: "REFRESH_REQUIRED",
    INTERNAL_INVARIANT: "INTERNAL_INVARIANT",
  });

  /**
   * Create one closed service failure without retaining request data.
   * @param {string} code - Closed service failure code.
   * @param {Error|null} [cause] - Internal technical cause.
   */
  constructor(code, cause = null) {
    if (!Object.values(CoverLetterServiceError.CODE).includes(code)) {
      throw new TypeError("Unknown CoverLetter service error code");
    }
    super(code, cause ? { cause } : undefined);
    this.name = "CoverLetterServiceError";
    this.code = code;
  }
}

export { CoverLetterServiceError };
