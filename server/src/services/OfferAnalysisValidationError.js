/**
 * Signals that an untrusted candidate violates the OfferAnalysis V1 contract.
 */
class OfferAnalysisValidationError extends TypeError {
  static CODE = Object.freeze({
    STRUCTURE: "STRUCTURE",
    UNKNOWN_KEY: "UNKNOWN_KEY",
    TYPE: "TYPE",
    ENUM: "ENUM",
    CARDINALITY: "CARDINALITY",
    EVIDENCE: "EVIDENCE",
    ASSERTION: "ASSERTION",
    REQUIREMENT_INFERRED: "REQUIREMENT_INFERRED",
    WORK_CONDITION_INFERRED: "WORK_CONDITION_INFERRED",
    EMPTY_ANALYSIS: "EMPTY_ANALYSIS",
    INVARIANT: "INVARIANT",
  });

  static EVIDENCE_SUBCODE = Object.freeze({
    INFERRED_EVIDENCE_PRESENT: "INFERRED_EVIDENCE_PRESENT",
    EXPLICIT_EVIDENCE_TEXT_INVALID: "EXPLICIT_EVIDENCE_TEXT_INVALID",
    EXPLICIT_EVIDENCE_TEXT_TOO_LONG: "EXPLICIT_EVIDENCE_TEXT_TOO_LONG",
    EXPLICIT_EVIDENCE_TEXT_NOT_FOUND: "EXPLICIT_EVIDENCE_TEXT_NOT_FOUND",
  });

  /**
   * Create a categorized contract violation with a controlled safe code.
   * @param {object} details - Validation failure details.
   * @param {string} details.validationCode - Closed safe validation category.
   * @param {string} [details.validationSubcode] - Closed safe evidence rule.
   * @param {string} details.message - Internal contract violation description.
   */
  constructor({ validationCode, validationSubcode, message }) {
    if (!Object.values(OfferAnalysisValidationError.CODE).includes(validationCode)) {
      throw new TypeError("Unknown OfferAnalysis validation code");
    }
    if (validationSubcode !== undefined
      && (validationCode !== OfferAnalysisValidationError.CODE.EVIDENCE
        || !Object.values(OfferAnalysisValidationError.EVIDENCE_SUBCODE)
          .includes(validationSubcode))) {
      throw new TypeError("Unknown OfferAnalysis validation subcode");
    }
    super(message);
    this.name = "OfferAnalysisValidationError";
    this.validationCode = validationCode;
    if (validationSubcode !== undefined) {
      this.validationSubcode = validationSubcode;
    }
  }
}

export { OfferAnalysisValidationError };
