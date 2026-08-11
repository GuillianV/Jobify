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

  /**
   * Create a categorized contract violation with a controlled safe code.
   * @param {object} details - Validation failure details.
   * @param {string} details.validationCode - Closed safe validation category.
   * @param {string} details.message - Internal contract violation description.
   */
  constructor({ validationCode, message }) {
    if (!Object.values(OfferAnalysisValidationError.CODE).includes(validationCode)) {
      throw new TypeError("Unknown OfferAnalysis validation code");
    }
    super(message);
    this.name = "OfferAnalysisValidationError";
    this.validationCode = validationCode;
  }
}

export { OfferAnalysisValidationError };
