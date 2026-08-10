const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS semantic_dedup_cache (
    cache_key TEXT PRIMARY KEY,
    policy_version TEXT NOT NULL,
    decision_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`;
const SELECT_SQL = "SELECT decision_json FROM semantic_dedup_cache WHERE cache_key = ?";
const INSERT_SQL = `
  INSERT OR IGNORE INTO semantic_dedup_cache
    (cache_key, policy_version, decision_json, created_at)
  VALUES (?, ?, ?, ?)
`;

/**
 * Persists minimal validated semantic component decisions independently of offers.
 */
class SemanticDedupCacheRepository {
  /**
   * Create the cache table and prepared statements.
   * @param {import("./Database.js").Database} database - Database wrapper.
   */
  constructor(database) {
    this.connection = database.getConnection();
    this.connection.exec(CREATE_TABLE_SQL);
    this.selectStatement = this.connection.prepare(SELECT_SQL);
    this.insertStatement = this.connection.prepare(INSERT_SQL);
  }

  /**
   * Read and parse one cached decision, ignoring corrupt payloads.
   * @param {string} cacheKey - SHA-256 cache key.
   * @returns {object|null} Parsed decision or null.
   */
  find(cacheKey) {
    const row = this.selectStatement.get(cacheKey);
    if (!row) {
      return null;
    }
    try {
      return JSON.parse(row.decision_json);
    } catch {
      return null;
    }
  }

  /**
   * Persist the first complete decision for one key without replacing it.
   * @param {string} cacheKey - SHA-256 cache key.
   * @param {string} policyVersion - Semantic policy version.
   * @param {object} decision - Minimal validated decision.
   * @returns {void}
   */
  insertOrIgnore(cacheKey, policyVersion, decision) {
    this.insertStatement.run(
      cacheKey,
      policyVersion,
      JSON.stringify(decision),
      new Date().toISOString(),
    );
  }
}

export { SemanticDedupCacheRepository };
