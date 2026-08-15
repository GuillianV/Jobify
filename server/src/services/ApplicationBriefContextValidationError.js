/**
 * Signals that a structurally valid ApplicationBrief contradicts its authoritative inputs.
 */
class ApplicationBriefContextValidationError extends TypeError {
  static CODE = "INVALID_APPLICATION_BRIEF_CONTEXT";

  static REASON = Object.freeze({
    INVALID_OFFER_REFERENCE: "INVALID_OFFER_REFERENCE",
    INVALID_EVIDENCE_REFERENCE: "INVALID_EVIDENCE_REFERENCE",
    EVIDENCE_VALUE_MISMATCH: "EVIDENCE_VALUE_MISMATCH",
    FACET_NOT_IN_REQUIREMENT: "FACET_NOT_IN_REQUIREMENT",
    INCOMPLETE_REQUIREMENT_COVERAGE: "INCOMPLETE_REQUIREMENT_COVERAGE",
    STALE_INPUT: "STALE_INPUT",
  });

  /**
   * Create one controlled contextual contract violation without input data.
   * @param {string} reason - Closed internal contextual reason.
   */
  constructor(reason) {
    if (!Object.values(ApplicationBriefContextValidationError.REASON).includes(reason)) {
      throw new TypeError("Unknown ApplicationBrief context validation reason");
    }
    super(ApplicationBriefContextValidationError.CODE);
    this.name = "ApplicationBriefContextValidationError";
    this.code = ApplicationBriefContextValidationError.CODE;
    this.reason = reason;
  }
}

export { ApplicationBriefContextValidationError };
