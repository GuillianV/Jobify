import { CandidateDossierRepositoryError } from "./CandidateDossierRepositoryError.js";

const SINGLETON_KEY = 1;
const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS candidate_dossier (
    singleton_key INTEGER PRIMARY KEY CHECK (singleton_key = 1),
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`;
const SELECT_SQL = "SELECT payload, updated_at FROM candidate_dossier WHERE singleton_key = ?";
const UPSERT_SQL = `
  INSERT INTO candidate_dossier (singleton_key, payload, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(singleton_key) DO UPDATE SET
    payload = excluded.payload,
    updated_at = excluded.updated_at
`;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/**
 * Persists the one canonical candidate dossier as an opaque JSON payload.
 */
class CandidateDossierRepository {
  /**
   * Create the singleton table and prepared statements on the shared database.
   * @param {import("./Database.js").Database} database - Database wrapper.
   */
  constructor(database) {
    try {
      this.connection = database.getConnection();
      this.connection.exec(CREATE_TABLE_SQL);
      this.selectStatement = this.connection.prepare(SELECT_SQL);
      this.upsertStatement = this.connection.prepare(UPSERT_SQL);
    } catch (error) {
      throw this.persistenceError(error);
    }
  }

  /**
   * Read and parse the singleton record without validating CandidateDossier semantics.
   * @returns {{payload: unknown, updatedAt: string}|null} Parsed record or absence.
   */
  find() {
    let row;
    try {
      row = this.selectStatement.get(SINGLETON_KEY);
    } catch (error) {
      throw this.persistenceError(error);
    }
    if (!row) {
      return null;
    }
    let payload;
    try {
      payload = JSON.parse(row.payload);
    } catch (error) {
      throw new CandidateDossierRepositoryError(
        CandidateDossierRepositoryError.CODE.INVALID_PERSISTED_JSON,
        error,
      );
    }
    if (!this.isCanonicalTimestamp(row.updated_at)) {
      throw new CandidateDossierRepositoryError(
        CandidateDossierRepositoryError.CODE.INVALID_PERSISTED_METADATA,
      );
    }
    return { payload, updatedAt: row.updated_at };
  }

  /**
   * Atomically create or replace the singleton with caller-supplied JSON and metadata.
   * @param {object} payload - Plain JSON object already validated by the caller.
   * @param {string} updatedAt - Canonical ISO UTC persistence timestamp.
   * @returns {{payload: object, updatedAt: string}} Detached persisted record.
   */
  save(payload, updatedAt) {
    if (!this.isCanonicalTimestamp(updatedAt)) {
      throw new CandidateDossierRepositoryError(
        CandidateDossierRepositoryError.CODE.INVALID_PERSISTED_METADATA,
      );
    }
    let serialized;
    let detached;
    try {
      if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
        throw new TypeError("Candidate dossier payload must be a plain JSON object");
      }
      serialized = JSON.stringify(payload);
      detached = JSON.parse(serialized);
    } catch (error) {
      throw this.persistenceError(error);
    }
    try {
      this.upsertStatement.run(SINGLETON_KEY, serialized, updatedAt);
    } catch (error) {
      throw this.persistenceError(error);
    }
    return { payload: detached, updatedAt };
  }

  /**
   * Tell whether a value is the exact canonical format produced by Date.toISOString.
   * @param {unknown} value - Timestamp candidate.
   * @returns {boolean} True only for one canonical ISO UTC timestamp.
   */
  isCanonicalTimestamp(value) {
    if (typeof value !== "string" || !ISO_UTC_PATTERN.test(value)) {
      return false;
    }
    try {
      return new Date(value).toISOString() === value;
    } catch {
      return false;
    }
  }

  /**
   * Wrap an internal failure without exposing SQL or candidate content.
   * @param {Error} cause - Internal technical failure.
   * @returns {CandidateDossierRepositoryError} Safe repository error.
   */
  persistenceError(cause) {
    return new CandidateDossierRepositoryError(
      CandidateDossierRepositoryError.CODE.PERSISTENCE_ERROR,
      cause,
    );
  }
}

export { CandidateDossierRepository };
