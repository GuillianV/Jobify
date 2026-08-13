/**
 * Safe orchestration failure raised by CandidateDossierService.
 */
class CandidateDossierServiceError extends Error {
  static CODE = Object.freeze({
    PERSISTENCE_ERROR: "PERSISTENCE_ERROR",
  });

  /**
   * Create a closed service error without candidate or storage details.
   * @param {string} code - Closed safe service error code.
   * @param {Error|null} [cause] - Internal technical cause.
   */
  constructor(code, cause = null) {
    if (!Object.values(CandidateDossierServiceError.CODE).includes(code)) {
      throw new TypeError("Unknown CandidateDossier service error code");
    }
    super(code, cause ? { cause } : undefined);
    this.name = "CandidateDossierServiceError";
    this.code = code;
    this.safeDetails = Object.freeze({});
  }
}

export { CandidateDossierServiceError };
