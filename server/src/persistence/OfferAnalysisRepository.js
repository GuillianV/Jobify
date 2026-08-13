const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS offer_analyses (
    cache_key TEXT PRIMARY KEY,
    offer_id INTEGER NOT NULL,
    content_fingerprint TEXT NOT NULL,
    deterministic_input_fingerprint TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    llm_provider TEXT NOT NULL,
    model TEXT NOT NULL,
    configured_max_output_tokens INTEGER NOT NULL,
    effective_max_output_tokens INTEGER NOT NULL,
    analysis_json TEXT NOT NULL,
    analyzed_at TEXT NOT NULL
  )
`;
const SELECT_SQL = "SELECT * FROM offer_analyses WHERE cache_key = ?";
const INSERT_SQL = `
  INSERT OR IGNORE INTO offer_analyses
    (cache_key, offer_id, content_fingerprint, deterministic_input_fingerprint,
      policy_version, schema_version, llm_provider, model,
      configured_max_output_tokens, effective_max_output_tokens,
      analysis_json, analyzed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
const DELETE_SQL = "DELETE FROM offer_analyses WHERE cache_key = ?";

/**
 * Persists immutable validated offer-analysis payloads by exact cache identity.
 */
class OfferAnalysisRepository {
  static STATUS = Object.freeze({
    MISS: "MISS",
    FOUND: "FOUND",
    CORRUPT: "CORRUPT",
  });

  /**
   * Create the cache table and prepared statements on the shared SQLite connection.
   * @param {import("./Database.js").Database} database - Database wrapper.
   */
  constructor(database) {
    this.connection = database.getConnection();
    this.connection.exec(CREATE_TABLE_SQL);
    this.selectStatement = this.connection.prepare(SELECT_SQL);
    this.insertStatement = this.connection.prepare(INSERT_SQL);
    this.deleteStatement = this.connection.prepare(DELETE_SQL);
  }

  /**
   * Find, cross-check and parse one entry without performing semantic validation.
   * @param {object} identity - Exact pre-provider cache identity.
   * @returns {object} Closed MISS, FOUND or CORRUPT repository result.
   */
  findByCacheIdentity(identity) {
    this.validateIdentity(identity);
    const row = this.selectStatement.get(identity.cacheKey);
    if (!row) {
      return { status: OfferAnalysisRepository.STATUS.MISS };
    }
    if (!this.rowMatchesIdentity(row, identity)) {
      return { status: OfferAnalysisRepository.STATUS.CORRUPT };
    }
    let analysisPayload;
    try {
      analysisPayload = JSON.parse(row.analysis_json);
    } catch {
      return { status: OfferAnalysisRepository.STATUS.CORRUPT };
    }
    return {
      status: OfferAnalysisRepository.STATUS.FOUND,
      identity,
      analysisPayload,
      effectiveMaxOutputTokens: row.effective_max_output_tokens,
      analyzedAt: row.analyzed_at,
    };
  }

  /**
   * Persist the first complete record for an identity without replacing a winner.
   * @param {object} record - Validated payload, deterministic identity and provenance.
   * @returns {{inserted: boolean}} Whether this call inserted the winning row.
   */
  insertOrIgnore(record) {
    this.validateRecord(record);
    const { identity } = record;
    const result = this.insertStatement.run(
      identity.cacheKey,
      identity.offerId,
      identity.contentFingerprint,
      identity.deterministicInputFingerprint,
      identity.policyVersion,
      identity.schemaVersion,
      identity.llmProvider,
      identity.model,
      identity.configuredMaxOutputTokens,
      record.effectiveMaxOutputTokens,
      JSON.stringify(record.analysisPayload),
      record.analyzedAt,
    );
    return { inserted: result.changes > 0 };
  }

  /**
   * Delete only the exact identity confirmed corrupt by the future runtime service.
   * @param {object} identity - Exact cache identity to remove.
   * @returns {{deleted: boolean}} Whether one targeted row was removed.
   */
  deleteCorruptByCacheIdentity(identity) {
    this.validateIdentity(identity);
    const result = this.deleteStatement.run(identity.cacheKey);
    return { deleted: result.changes > 0 };
  }

  /**
   * Compare every persisted identity column with the requested immutable identity.
   * @param {object} row - Selected SQLite row.
   * @param {object} identity - Requested identity.
   * @returns {boolean} True only when every identity component is coherent.
   */
  rowMatchesIdentity(row, identity) {
    return row.cache_key === identity.cacheKey
      && row.offer_id === identity.offerId
      && row.content_fingerprint === identity.contentFingerprint
      && row.deterministic_input_fingerprint === identity.deterministicInputFingerprint
      && row.policy_version === identity.policyVersion
      && row.schema_version === identity.schemaVersion
      && row.llm_provider === identity.llmProvider
      && row.model === identity.model
      && row.configured_max_output_tokens === identity.configuredMaxOutputTokens;
  }

  /**
   * Validate the minimal shape expected from OfferAnalysisCacheIdentity.
   * @param {unknown} identity - Identity candidate.
   * @returns {void}
   */
  validateIdentity(identity) {
    if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
      throw new TypeError("OfferAnalysisRepository requires a cache identity");
    }
    const stringFields = [
      "cacheKey",
      "contentFingerprint",
      "deterministicInputFingerprint",
      "policyVersion",
      "schemaVersion",
      "llmProvider",
      "model",
    ];
    for (const field of stringFields) {
      if (typeof identity[field] !== "string" || !identity[field].trim()) {
        throw new TypeError(`OfferAnalysisRepository identity ${field} must be non-empty`);
      }
    }
    const numericFields = ["offerId", "configuredMaxOutputTokens"];
    for (const field of numericFields) {
      if (!Number.isSafeInteger(identity[field]) || identity[field] <= 0) {
        throw new TypeError(`OfferAnalysisRepository identity ${field} must be positive`);
      }
    }
  }

  /**
   * Validate one persistable analysis payload and immutable provenance envelope.
   * @param {unknown} record - Record candidate.
   * @returns {void}
   */
  validateRecord(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new TypeError("OfferAnalysisRepository requires a record");
    }
    this.validateIdentity(record.identity);
    if (record.analysisPayload === null
      || typeof record.analysisPayload !== "object"
      || Array.isArray(record.analysisPayload)) {
      throw new TypeError("OfferAnalysisRepository requires an analysis payload");
    }
    if (!Number.isSafeInteger(record.effectiveMaxOutputTokens)
      || record.effectiveMaxOutputTokens <= 0
      || record.effectiveMaxOutputTokens
        > record.identity.configuredMaxOutputTokens) {
      throw new TypeError("OfferAnalysisRepository effective token limit is invalid");
    }
    if (typeof record.analyzedAt !== "string"
      || !record.analyzedAt.trim()
      || Number.isNaN(Date.parse(record.analyzedAt))) {
      throw new TypeError("OfferAnalysisRepository analyzedAt must be a timestamp");
    }
  }
}

export { OfferAnalysisRepository };
