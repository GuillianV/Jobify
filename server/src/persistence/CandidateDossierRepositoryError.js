/**
 * Safe persistence failure raised by CandidateDossierRepository.
 */
class CandidateDossierRepositoryError extends Error {
  static CODE = Object.freeze({
    PERSISTENCE_ERROR: "PERSISTENCE_ERROR",
    INVALID_PERSISTED_JSON: "INVALID_PERSISTED_JSON",
    INVALID_PERSISTED_METADATA: "INVALID_PERSISTED_METADATA",
  });

  /**
   * Create a repository error without retaining candidate payload details.
   * @param {string} code - Closed safe repository error code.
   * @param {Error|null} [cause] - Internal technical cause.
   */
  constructor(code, cause = null) {
    if (!Object.values(CandidateDossierRepositoryError.CODE).includes(code)) {
      throw new TypeError("Unknown CandidateDossier repository error code");
    }
    super(code, cause ? { cause } : undefined);
    this.name = "CandidateDossierRepositoryError";
    this.code = code;
  }
}

export { CandidateDossierRepositoryError };
