/**
 * Signals that an untrusted value violates the ApplicationBrief V1 contract.
 */
class ApplicationBriefValidationError extends TypeError {
  static CODE = "INVALID_APPLICATION_BRIEF";

  /**
   * Create one controlled structural contract violation.
   * @param {string} message - Internal safe validation description.
   */
  constructor(message) {
    super(message);
    this.name = "ApplicationBriefValidationError";
    this.code = ApplicationBriefValidationError.CODE;
  }
}

export { ApplicationBriefValidationError };
