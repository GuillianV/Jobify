/**
 * Stable execution policy for the in-memory Offer Analyzer V1.
 */
class OfferAnalyzerConstants {
  static POLICY_VERSION = "offer-analyzer-v1";

  static PROVIDER = "GROQ";

  static MAX_INPUT_LENGTH = 100000;

  static MAX_OUTPUT_TOKENS = 8192;

  static TIMEOUT_MS = 30000;
}

export { OfferAnalyzerConstants };
