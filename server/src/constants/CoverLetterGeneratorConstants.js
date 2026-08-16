/**
 * Stable execution policy for CoverLetter generation V1.
 */
class CoverLetterGeneratorConstants {
  static MAX_INPUT_CHARACTERS = 40000;

  static MAX_OUTPUT_TOKENS = 1200;

  static MINIMUM_RETRY_OUTPUT_TOKENS = 600;

  static TOKEN_BUDGET_SAFETY_MARGIN = 1;

  static TIMEOUT_MS = 30000;
}

export { CoverLetterGeneratorConstants };
