/**
 * Stable execution policy for the ApplicationBrief semantic matcher V1.
 */
class ApplicationBriefMatcherConstants {
  static POLICY_VERSION = "application-brief-matcher-v1";

  static MAX_INPUT_CHARACTERS = 100000;

  static MAX_OUTPUT_TOKENS = 4096;

  static MINIMUM_RETRY_OUTPUT_TOKENS = 2048;

  static TOKEN_BUDGET_SAFETY_MARGIN = 1;

  static TIMEOUT_MS = 30000;
}

export { ApplicationBriefMatcherConstants };
