import { GroqRateLimitConstants } from "../constants/GroqRateLimitConstants.js";

/**
 * Extracts a closed typed subset of Groq rate-limit response headers.
 */
class GroqRateLimitMetadata {
  static INTEGER_PATTERN = /^(?:0|[1-9]\d*)$/u;

  static DURATION_PATTERN = /^(?:(?<hours>\d+)h)?(?:(?<minutes>\d+)m)?(?:(?<seconds>\d+(?:\.\d{1,3})?)s)?$/u;

  /**
   * Extract the explicit provider header whitelist into typed nullable fields.
   * @param {Headers|object|null|undefined} headers - Fetch-compatible response headers.
   * @returns {object} Closed typed rate-limit metadata.
   */
  static fromHeaders(headers) {
    const names = GroqRateLimitConstants.HEADER;
    return {
      rateLimitTokenLimit: this.parseInteger(this.read(headers, names.TOKEN_LIMIT)),
      rateLimitTokenRemaining: this.parseInteger(this.read(headers, names.TOKEN_REMAINING)),
      rateLimitTokenResetMs: this.parseDuration(this.read(headers, names.TOKEN_RESET)),
      rateLimitRequestLimit: this.parseInteger(this.read(headers, names.REQUEST_LIMIT)),
      rateLimitRequestRemaining: this.parseInteger(
        this.read(headers, names.REQUEST_REMAINING),
      ),
      rateLimitRequestResetMs: this.parseDuration(this.read(headers, names.REQUEST_RESET)),
      retryAfterMs: this.parseRetryAfter(this.read(headers, names.RETRY_AFTER)),
    };
  }

  /**
   * Read one explicitly selected header without enumerating the collection.
   * @param {Headers|object|null|undefined} headers - Fetch-compatible response headers.
   * @param {string} name - Whitelisted lower-case header name.
   * @returns {string|null} Exact header value or null.
   */
  static read(headers, name) {
    if (headers === null || typeof headers !== "object"
      || typeof headers.get !== "function") {
      return null;
    }
    const value = headers.get(name);
    return typeof value === "string" ? value : null;
  }

  /**
   * Parse one strict base-ten non-negative safe integer.
   * @param {unknown} value - Exact header value.
   * @returns {number|null} Parsed integer or null.
   */
  static parseInteger(value) {
    if (typeof value !== "string" || !this.INTEGER_PATTERN.test(value)) {
      return null;
    }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  /**
   * Parse one strict ordered Groq duration using hour, minute and second units.
   * @param {unknown} value - Exact reset header value.
   * @returns {number|null} Non-negative safe integer milliseconds or null.
   */
  static parseDuration(value) {
    if (typeof value !== "string") {
      return null;
    }
    const match = value.match(this.DURATION_PATTERN);
    if (match === null || match[0].length === 0
      || Object.values(match.groups).every((part) => {
        return part === undefined;
      })) {
      return null;
    }
    const hours = match.groups.hours === undefined ? 0 : Number(match.groups.hours);
    const minutes = match.groups.minutes === undefined ? 0 : Number(match.groups.minutes);
    const seconds = match.groups.seconds === undefined ? 0 : Number(match.groups.seconds);
    const totalSeconds = (
      hours * GroqRateLimitConstants.MINUTES_PER_HOUR
        * GroqRateLimitConstants.SECONDS_PER_MINUTE
      + minutes * GroqRateLimitConstants.SECONDS_PER_MINUTE
      + seconds
    );
    const milliseconds = Math.round(
      totalSeconds * GroqRateLimitConstants.MILLISECONDS_PER_SECOND,
    );
    return Number.isSafeInteger(milliseconds) && milliseconds >= 0 ? milliseconds : null;
  }

  /**
   * Parse the conservative Retry-After delay-seconds form only.
   * @param {unknown} value - Exact Retry-After header value.
   * @returns {number|null} Non-negative safe integer milliseconds or null.
   */
  static parseRetryAfter(value) {
    const seconds = this.parseInteger(value);
    if (seconds === null) {
      return null;
    }
    const milliseconds = seconds * GroqRateLimitConstants.MILLISECONDS_PER_SECOND;
    return Number.isSafeInteger(milliseconds) ? milliseconds : null;
  }
}

export { GroqRateLimitMetadata };
