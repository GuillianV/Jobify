/**
 * Stable safe failure raised by ApplicationBrief semantic matching components.
 */
class ApplicationBriefMatcherError extends Error {
  static CODE = Object.freeze({
    INVALID_OUTPUT: "INVALID_APPLICATION_BRIEF_OUTPUT",
    INPUT_TOO_LARGE: "APPLICATION_BRIEF_INPUT_TOO_LARGE",
    UNAVAILABLE: "APPLICATION_BRIEF_UNAVAILABLE",
    TIMEOUT: "APPLICATION_BRIEF_TIMEOUT",
    RATE_LIMITED: "APPLICATION_BRIEF_RATE_LIMITED",
    PROVIDER_TOKEN_BUDGET: "APPLICATION_BRIEF_PROVIDER_TOKEN_BUDGET",
    PROVIDER_ERROR: "APPLICATION_BRIEF_PROVIDER_ERROR",
  });

  static REASON = Object.freeze({
    INVALID_SEMANTIC_OUTPUT: "INVALID_SEMANTIC_OUTPUT",
    INVALID_CONTEXTUAL_OUTPUT: "INVALID_CONTEXTUAL_OUTPUT",
  });

  static VALIDATION_CODE = Object.freeze({
    PROVIDER_INVALID_RESPONSE: "PROVIDER_INVALID_RESPONSE",
    SEMANTIC_VALIDATION: "SEMANTIC_VALIDATION",
    CONTEXTUAL_VALIDATION: "CONTEXTUAL_VALIDATION",
  });

  static SEMANTIC_VALIDATION_SUBCODE = Object.freeze({
    ROOT_SHAPE_OR_KEYS: "ROOT_SHAPE_OR_KEYS",
    NESTED_SHAPE_OR_KEYS: "NESTED_SHAPE_OR_KEYS",
    TYPE: "TYPE",
    ENUM: "ENUM",
    TEXT_OR_IDENTIFIER_FORMAT: "TEXT_OR_IDENTIFIER_FORMAT",
    CARDINALITY: "CARDINALITY",
    DUPLICATE: "DUPLICATE",
    STATE_FACET_INVARIANT: "STATE_FACET_INVARIANT",
    CLAIM_EVIDENCE_KIND_MISMATCH: "CLAIM_EVIDENCE_KIND_MISMATCH",
    EVIDENCE_GLOBAL_LIMIT: "EVIDENCE_GLOBAL_LIMIT",
  });

  /**
   * Create a matcher failure without retaining prompt or candidate content.
   * @param {string} code - Stable matcher failure code and safe message.
   * @param {string|null} [reason] - Closed internal reason when applicable.
   * @param {Error|null} [cause] - Internal technical cause.
   * @param {object} [safeDetails] - Closed technical validation diagnostics.
   */
  constructor(code, reason = null, cause = null, safeDetails = {}) {
    super(code, cause ? { cause } : undefined);
    this.name = "ApplicationBriefMatcherError";
    this.code = code;
    this.reason = reason;
    this.safeDetails = ApplicationBriefMatcherError.createSafeDetails(
      safeDetails?.validationCode,
      safeDetails?.validationSubcode,
    );
  }

  /**
   * Accept only contextually coherent closed diagnostic identifiers.
   * @param {unknown} validationCode - Validation category candidate.
   * @param {unknown} validationSubcode - Validation detail candidate.
   * @returns {{validationCode: string|null, validationSubcode: string|null}} Safe details.
   */
  static createSafeDetails(validationCode, validationSubcode) {
    if (!Object.values(ApplicationBriefMatcherError.VALIDATION_CODE)
      .includes(validationCode)) {
      return { validationCode: null, validationSubcode: null };
    }
    const semanticCode = ApplicationBriefMatcherError
      .VALIDATION_CODE.SEMANTIC_VALIDATION;
    const safeSubcode = validationCode === semanticCode
      && Object.values(ApplicationBriefMatcherError.SEMANTIC_VALIDATION_SUBCODE)
        .includes(validationSubcode)
      ? validationSubcode
      : null;
    return { validationCode, validationSubcode: safeSubcode };
  }
}

export { ApplicationBriefMatcherError };
