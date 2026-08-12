/**
 * Stable execution policy for the in-memory Offer Analyzer V4.
 */
class OfferAnalyzerConstants {
  static POLICY_VERSION = "offer-analyzer-v4";

  static PROVIDER = "GROQ";

  static MAX_INPUT_LENGTH = 100000;

  static MAX_OUTPUT_TOKENS = 4096;

  static MINIMUM_RETRY_OUTPUT_TOKENS = 2048;

  static TOKEN_BUDGET_SAFETY_MARGIN = 1;

  static TIMEOUT_MS = 30000;
}

export { OfferAnalyzerConstants };
