/**
 * Signals that an untrusted value violates the CandidateDossier V1 contract.
 */
class CandidateDossierValidationError extends TypeError {
  static CODE = Object.freeze({
    INVALID_STRUCTURE: "INVALID_STRUCTURE",
    UNKNOWN_FIELD: "UNKNOWN_FIELD",
    INVALID_ENUM: "INVALID_ENUM",
    INVALID_ID: "INVALID_ID",
    DUPLICATE_ID: "DUPLICATE_ID",
    INVALID_TEXT: "INVALID_TEXT",
    INVALID_DATE: "INVALID_DATE",
    LIMIT_EXCEEDED: "LIMIT_EXCEEDED",
    INVALID_INVARIANT: "INVALID_INVARIANT",
  });

  static ENUM_SUBCODE = Object.freeze({
    SKILL_CATEGORY: "SKILL_CATEGORY",
  });

  /**
   * Create a categorized contract violation with controlled safe diagnostics.
   * @param {object} details - Validation failure details.
   * @param {string} details.validationCode - Closed safe validation category.
   * @param {string} [details.validationSubcode] - Closed safe enum rule.
   * @param {string} details.message - Internal contract violation description.
   */
  constructor({ validationCode, validationSubcode, message }) {
    if (!Object.values(CandidateDossierValidationError.CODE).includes(validationCode)) {
      throw new TypeError("Unknown CandidateDossier validation code");
    }
    const validSubcode = validationCode === CandidateDossierValidationError.CODE.INVALID_ENUM
      && Object.values(CandidateDossierValidationError.ENUM_SUBCODE)
        .includes(validationSubcode);
    if (validationSubcode !== undefined && !validSubcode) {
      throw new TypeError("Unknown CandidateDossier validation subcode");
    }
    super(message);
    this.name = "CandidateDossierValidationError";
    this.validationCode = validationCode;
    if (validationSubcode !== undefined) {
      this.validationSubcode = validationSubcode;
    }
  }
}

export { CandidateDossierValidationError };
