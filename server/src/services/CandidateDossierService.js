import { CandidateDossier } from "../models/CandidateDossier.js";
import { CandidateDossierRepositoryError } from "../persistence/CandidateDossierRepositoryError.js";
import { CandidateDossierServiceError } from "./CandidateDossierServiceError.js";
import { CandidateDossierValidationError } from "./CandidateDossierValidationError.js";

/**
 * Orchestrates the validated singleton CandidateDossier persistence boundary.
 */
class CandidateDossierService {
  /**
   * Create the dossier service with explicit persistence, validation, and clock dependencies.
   * @param {object} dependencies - Service dependencies.
   * @param {import("../persistence/CandidateDossierRepository.js").CandidateDossierRepository} dependencies.candidateDossierRepository - Singleton repository.
   * @param {import("./CandidateDossierValidator.js").CandidateDossierValidator} dependencies.candidateDossierValidator - Domain validator.
   * @param {Function} dependencies.now - Canonical timestamp provider.
   */
  constructor({ candidateDossierRepository, candidateDossierValidator, now }) {
    this.candidateDossierRepository = candidateDossierRepository;
    this.candidateDossierValidator = candidateDossierValidator;
    this.now = now;
  }

  /**
   * Return the validated persisted dossier or the official empty domain value.
   * @returns {{dossier: CandidateDossier, updatedAt: string|null}} Domain dossier and persistence metadata.
   */
  get() {
    const record = this.#find();
    if (record === null) {
      return {
        dossier: CandidateDossier.empty(),
        updatedAt: null,
      };
    }
    return {
      dossier: this.#validatePersisted(record.payload),
      updatedAt: record.updatedAt,
    };
  }

  /**
   * Validate and persist one complete candidate dossier.
   * @param {unknown} rawDossier - Untrusted complete dossier input.
   * @returns {{dossier: CandidateDossier, updatedAt: string}} Authoritative persisted result.
   */
  save(rawDossier) {
    const dossier = this.candidateDossierValidator.validate(rawDossier);
    const updatedAt = this.now();
    const record = this.#save(dossier.toJson(), updatedAt);
    return {
      dossier: this.#validatePersisted(record.payload),
      updatedAt: record.updatedAt,
    };
  }

  /**
   * Read the repository while hiding persistence implementation errors.
   * @returns {{payload: unknown, updatedAt: string}|null} Parsed singleton record.
   */
  #find() {
    try {
      return this.candidateDossierRepository.find();
    } catch (error) {
      if (error instanceof CandidateDossierRepositoryError) {
        throw this.#persistenceError(error);
      }
      throw error;
    }
  }

  /**
   * Persist an already validated payload while hiding repository implementation errors.
   * @param {object} payload - Detached validated dossier.
   * @param {string} updatedAt - Caller clock value.
   * @returns {{payload: unknown, updatedAt: string}} Authoritative repository record.
   */
  #save(payload, updatedAt) {
    try {
      return this.candidateDossierRepository.save(payload, updatedAt);
    } catch (error) {
      if (error instanceof CandidateDossierRepositoryError) {
        throw this.#persistenceError(error);
      }
      throw error;
    }
  }

  /**
   * Validate a repository-originated payload as trusted service output.
   * @param {unknown} payload - Parsed repository payload.
   * @returns {CandidateDossier} Validated immutable domain object.
   */
  #validatePersisted(payload) {
    try {
      return this.candidateDossierValidator.validate(payload);
    } catch (error) {
      if (error instanceof CandidateDossierValidationError) {
        throw this.#persistenceError(error);
      }
      throw error;
    }
  }

  /**
   * Build one safe persistence service error without candidate details.
   * @param {Error} cause - Internal persistence or persisted-validation failure.
   * @returns {CandidateDossierServiceError} Closed safe service error.
   */
  #persistenceError(cause) {
    return new CandidateDossierServiceError(
      CandidateDossierServiceError.CODE.PERSISTENCE_ERROR,
      cause,
    );
  }
}

export { CandidateDossierService };
