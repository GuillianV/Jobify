/**
 * Stable execution policy for the ApplicationBrief semantic matcher V1.
 */
class ApplicationBriefMatcherConstants {
  static POLICY_VERSION = "application-brief-matcher-v1";

  static MAX_INPUT_CHARACTERS = 100000;

  static MAX_OUTPUT_TOKENS = 4096;

  static MINIMUM_RETRY_OUTPUT_TOKENS = 2048;

  static TOKEN_BUDGET_SAFETY_MARGIN = 1;

  static TOKEN_BUDGET_HTTP_STATUS = 413;

  static TOKEN_BUDGET_PROVIDER_TYPE = "tokens";

  static TOKEN_BUDGET_PROVIDER_CODE = "rate_limit_exceeded";

  static TOKEN_BUDGET_RETRY_REASON = "TOKEN_BUDGET_413";

  static CROSS_CLASS_RETRY_REASON = "JSON_VALIDATE_FAILED_AFTER_TOKEN_BUDGET_413";

  static JSON_VALIDATION_RETRY_MODEL = "openai/gpt-oss-120b";

  static JSON_VALIDATION_HTTP_STATUS = 400;

  static JSON_VALIDATION_PROVIDER_TYPE = "invalid_request_error";

  static JSON_VALIDATION_PROVIDER_CODE = "json_validate_failed";

  static RETRY_ATTEMPT = 2;

  static FINAL_CROSS_CLASS_RETRY_ATTEMPT = 3;

  static ABSOLUTE_PROVIDER_CALL_CAP = 3;

  static LOCAL_REGENERATION_MAX = 1;

  static TIMEOUT_MS = 30000;
}

export { ApplicationBriefMatcherConstants };
