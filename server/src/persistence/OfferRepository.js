const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS offers (
    dedup_key TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    source_id TEXT,
    title TEXT,
    company_name TEXT,
    city TEXT,
    published_at TEXT,
    apply_url TEXT,
    payload TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_offers_first_seen ON offers(first_seen_at);
  CREATE INDEX IF NOT EXISTS idx_offers_published ON offers(published_at);
`;

const INSERT_SQL = `
  INSERT INTO offers
    (dedup_key, source, source_id, title, company_name, city, published_at, apply_url, payload, first_seen_at, last_seen_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const UPDATE_SQL = `
  UPDATE offers
  SET payload = ?, published_at = ?, apply_url = ?, last_seen_at = ?
  WHERE dedup_key = ?
`;

const SELECT_KEY_SQL = "SELECT dedup_key FROM offers WHERE dedup_key = ?";

/**
 * Persists canonical offers, keyed by their deduplication key. Tracks when each
 * offer was first and last seen, so newly discovered offers can be surfaced
 * later (notifications). Existing offers are refreshed in place.
 */
class OfferRepository {
  /**
   * Prepare the statements used by the repository.
   * @param {import("./Database.js").Database} database - The database wrapper.
   */
  constructor(database) {
    this.connection = database.getConnection();
    this.connection.exec(SCHEMA_SQL);
    this.selectStatement = this.connection.prepare(SELECT_KEY_SQL);
    this.insertStatement = this.connection.prepare(INSERT_SQL);
    this.updateStatement = this.connection.prepare(UPDATE_SQL);
  }

  /**
   * Insert or refresh every offer in a single transaction.
   * @param {import("../models/JobOffer.js").JobOffer[]} offers - The offers to persist.
   * @returns {import("../models/JobOffer.js").JobOffer[]} The offers seen for the first time.
   */
  upsertMany(offers) {
    const now = new Date().toISOString();
    const newlySeen = [];
    this.connection.exec("BEGIN");
    try {
      for (const offer of offers) {
        if (this.upsertOne(offer, now)) {
          newlySeen.push(offer);
        }
      }
      this.connection.exec("COMMIT");
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
    return newlySeen;
  }

  /**
   * Insert a single offer, or refresh it when its key already exists.
   * @param {import("../models/JobOffer.js").JobOffer} offer - The offer to persist.
   * @param {string} now - The current ISO timestamp.
   * @returns {boolean} True when the offer was seen for the first time.
   */
  upsertOne(offer, now) {
    const key = offer.getDeduplicationKey();
    const payload = JSON.stringify(offer.toJson());
    const existing = this.selectStatement.get(key);
    if (existing) {
      this.updateStatement.run(payload, offer.publishedAt ?? null, offer.applyUrl ?? null, now, key);
      return false;
    }
    this.insertStatement.run(
      key,
      offer.source,
      offer.sourceId ?? null,
      offer.title ?? null,
      offer.company?.name ?? null,
      offer.location?.city ?? null,
      offer.publishedAt ?? null,
      offer.applyUrl ?? null,
      payload,
      now,
      now,
    );
    return true;
  }
}

export { OfferRepository };
