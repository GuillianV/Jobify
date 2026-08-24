/**
 * Defines the closed Groq rate-limit header and duration parsing contract.
 */
class GroqRateLimitConstants {
  static HEADER = Object.freeze({
    RETRY_AFTER: "retry-after",
    TOKEN_LIMIT: "x-ratelimit-limit-tokens",
    TOKEN_REMAINING: "x-ratelimit-remaining-tokens",
    TOKEN_RESET: "x-ratelimit-reset-tokens",
    REQUEST_LIMIT: "x-ratelimit-limit-requests",
    REQUEST_REMAINING: "x-ratelimit-remaining-requests",
    REQUEST_RESET: "x-ratelimit-reset-requests",
  });

  static MILLISECONDS_PER_SECOND = 1000;

  static SECONDS_PER_MINUTE = 60;

  static MINUTES_PER_HOUR = 60;
}

export { GroqRateLimitConstants };
