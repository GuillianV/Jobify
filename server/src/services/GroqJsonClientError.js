const MINIMUM_HTTP_STATUS = 100;
const MAXIMUM_HTTP_STATUS = 599;
const MAXIMUM_PROVIDER_METADATA_LENGTH = 80;
const PROVIDER_METADATA_PATTERN = /^[A-Za-z0-9_.:/-]+$/u;

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
    this.safeDetails = code === GroqJsonClientError.CODE.HTTP_ERROR
      ? GroqJsonClientError.createHttpSafeDetails(
        safeDetails?.status,
        safeDetails?.providerType,
        safeDetails?.providerCode,
      )
      : structuredClone(safeDetails);
  }

  /**
   * Build the closed safe diagnostic shape for one generic provider HTTP failure.
   * @param {unknown} status - Provider HTTP status candidate.
   * @param {unknown} providerType - Provider technical type candidate.
   * @param {unknown} providerCode - Provider technical code candidate.
   * @returns {{status: number|null, providerType: string|null, providerCode: string|null}} Safe details.
   */
  static createHttpSafeDetails(status, providerType, providerCode) {
    const safeStatus = Number.isInteger(status)
      && status >= MINIMUM_HTTP_STATUS
      && status <= MAXIMUM_HTTP_STATUS
      ? status
      : null;
    return {
      status: safeStatus,
      providerType: GroqJsonClientError.sanitizeProviderMetadata(providerType),
      providerCode: GroqJsonClientError.sanitizeProviderMetadata(providerCode),
    };
  }

  /**
   * Accept only bounded technical identifiers without preserving arbitrary provider text.
   * @param {unknown} value - Provider metadata candidate.
   * @returns {string|null} Safe technical identifier or null.
   */
  static sanitizeProviderMetadata(value) {
    if (typeof value !== "string"
      || value.length === 0
      || value.length > MAXIMUM_PROVIDER_METADATA_LENGTH
      || !PROVIDER_METADATA_PATTERN.test(value)) {
      return null;
    }
    return value;
  }
}

export { GroqJsonClientError };
