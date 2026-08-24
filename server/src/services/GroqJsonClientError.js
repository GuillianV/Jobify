import { GroqRateLimitMetadata } from "./GroqRateLimitMetadata.js";

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
    if (code === GroqJsonClientError.CODE.HTTP_ERROR) {
      this.safeDetails = GroqJsonClientError.createHttpSafeDetails(
        safeDetails?.status,
        safeDetails?.providerType,
        safeDetails?.providerCode,
        safeDetails,
      );
    } else if (code === GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED) {
      this.safeDetails = GroqJsonClientError.createTokenBudgetSafeDetails(safeDetails);
    } else if (code === GroqJsonClientError.CODE.RATE_LIMITED
      || code === GroqJsonClientError.CODE.AUTHENTICATION_ERROR) {
      this.safeDetails = GroqJsonClientError.createStatusSafeDetails(
        safeDetails?.status,
        safeDetails,
      );
    } else {
      this.safeDetails = structuredClone(safeDetails);
    }
  }

  /**
   * Build the closed safe diagnostic shape for one generic provider HTTP failure.
   * @param {unknown} status - Provider HTTP status candidate.
   * @param {unknown} providerType - Provider technical type candidate.
   * @param {unknown} providerCode - Provider technical code candidate.
   * @param {object} [rateLimitDetails] - Optional typed rate-limit candidates.
   * @returns {{status: number|null, providerType: string|null, providerCode: string|null}} Safe details.
   */
  static createHttpSafeDetails(status, providerType, providerCode, rateLimitDetails) {
    const safeStatus = Number.isInteger(status)
      && status >= MINIMUM_HTTP_STATUS
      && status <= MAXIMUM_HTTP_STATUS
      ? status
      : null;
    const details = {
      status: safeStatus,
      providerType: GroqJsonClientError.sanitizeProviderMetadata(providerType),
      providerCode: GroqJsonClientError.sanitizeProviderMetadata(providerCode),
    };
    if (rateLimitDetails !== undefined) {
      Object.assign(
        details,
        GroqJsonClientError.createRateLimitSafeDetails(rateLimitDetails),
      );
    }
    return details;
  }

  /**
   * Build safe status and rate-limit details for closed dedicated HTTP classifications.
   * @param {unknown} status - Provider HTTP status candidate.
   * @param {object} rateLimitDetails - Typed metadata candidates.
   * @returns {object} Closed safe status metadata.
   */
  static createStatusSafeDetails(status, rateLimitDetails = {}) {
    return {
      status: GroqJsonClientError.createHttpSafeDetails(status).status,
      ...GroqJsonClientError.createRateLimitSafeDetails(rateLimitDetails),
    };
  }

  /**
   * Preserve recognized body token metrics separately from typed header metadata.
   * @param {object} details - Recognized token-budget and rate-limit candidates.
   * @returns {object} Closed safe token-budget metadata.
   */
  static createTokenBudgetSafeDetails(details = {}) {
    const limitTokens = GroqRateLimitMetadata.parseInteger(String(details?.limitTokens));
    const requestedTokens = GroqRateLimitMetadata.parseInteger(String(details?.requestedTokens));
    return {
      limitTokens,
      requestedTokens,
      ...GroqJsonClientError.createRateLimitSafeDetails(details),
    };
  }

  /**
   * Accept only the closed nullable integer rate-limit metadata fields.
   * @param {object} details - Typed metadata candidates.
   * @returns {object} Sanitized typed rate-limit metadata.
   */
  static createRateLimitSafeDetails(details = {}) {
    const empty = GroqRateLimitMetadata.fromHeaders(null);
    return Object.fromEntries(Object.keys(empty).map((field) => {
      const value = details?.[field];
      return [field, Number.isSafeInteger(value) && value >= 0 ? value : null];
    }));
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
