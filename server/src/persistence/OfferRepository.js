import { CareerjetSurrogateIdentity } from "../identity/CareerjetSurrogateIdentity.js";
import { JobSource } from "../constants/JobSource.js";
import { OfferIdentityKind } from "../constants/OfferIdentityKind.js";
import { JobOffer } from "../models/JobOffer.js";

const TABLE_NAME = "offers";
const LEGACY_PRIMARY_KEY_COLUMN = "dedup_key";
const TARGET_PRIMARY_KEY_COLUMN = "id";
const TARGET_COLUMNS = new Set([
  "id",
  "source",
  "source_id",
  "identity_kind",
  "surrogate_key",
  "payload",
  "first_seen_at",
  "last_seen_at",
  "dedup_key",
]);
const STABLE_SOURCES = new Set([
  JobSource.FRANCE_TRAVAIL,
  JobSource.ADZUNA,
  JobSource.HELLOWORK,
]);

const CREATE_TABLE_SQL = `
  CREATE TABLE offers (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    source_id TEXT,
    identity_kind TEXT NOT NULL,
    surrogate_key TEXT,
    payload TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    dedup_key TEXT NOT NULL
  )
`;

const CREATE_INDEXES_SQL = `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_offers_stable_identity
    ON offers(source, source_id)
    WHERE identity_kind = 'STABLE';
  CREATE INDEX IF NOT EXISTS idx_offers_surrogate
    ON offers(source, identity_kind, surrogate_key);
  CREATE INDEX IF NOT EXISTS idx_offers_dedup ON offers(dedup_key);
  CREATE INDEX IF NOT EXISTS idx_offers_first_seen ON offers(first_seen_at);
`;

const INSERT_SQL = `
  INSERT INTO offers
    (source, source_id, identity_kind, surrogate_key, payload, first_seen_at, last_seen_at, dedup_key)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;

const UPDATE_SQL = `
  UPDATE offers
  SET source_id = ?, surrogate_key = ?, payload = ?, last_seen_at = ?, dedup_key = ?
  WHERE id = ?
`;

const SELECT_STABLE_SQL = `
  SELECT * FROM offers
  WHERE source = ? AND source_id = ? AND identity_kind = 'STABLE'
`;

const SELECT_SURROGATE_SQL = `
  SELECT * FROM offers
  WHERE source = ? AND identity_kind = 'SURROGATE' AND surrogate_key = ?
`;

const SELECT_ID_SQL = "SELECT * FROM offers WHERE id = ?";
const UPDATE_CONTENT_SQL = "UPDATE offers SET payload = ? WHERE id = ?";

/**
 * Persists provider observations using their provider identity while retaining
 * the cross-provider deduplication key only as a similarity signal.
 */
class OfferRepository {
  /**
   * Prepare the schema and statements used by the repository.
   * @param {import("./Database.js").Database} database - The database wrapper.
   */
  constructor(database) {
    this.connection = database.getConnection();
    this.migrateSchema();
    this.insertStatement = this.connection.prepare(INSERT_SQL);
    this.updateStatement = this.connection.prepare(UPDATE_SQL);
    this.selectStableStatement = this.connection.prepare(SELECT_STABLE_SQL);
    this.selectSurrogateStatement = this.connection.prepare(SELECT_SURROGATE_SQL);
    this.selectIdStatement = this.connection.prepare(SELECT_ID_SQL);
    this.updateContentStatement = this.connection.prepare(UPDATE_CONTENT_SQL);
  }

  /**
   * Create the target schema or transactionally rebuild the historical table.
   * @returns {void}
   */
  migrateSchema() {
    const table = this.connection.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(TABLE_NAME);
    if (!table) {
      this.connection.exec(CREATE_TABLE_SQL);
      this.connection.exec(CREATE_INDEXES_SQL);
      return;
    }
    const columns = this.connection.prepare("PRAGMA table_info(offers)").all();
    const primaryKey = columns.find((column) => {
      return column.pk === 1;
    });
    if (primaryKey?.name === TARGET_PRIMARY_KEY_COLUMN) {
      const columnNames = new Set(columns.map((column) => {
        return column.name;
      }));
      const missingColumns = [...TARGET_COLUMNS].filter((columnName) => {
        return !columnNames.has(columnName);
      });
      if (missingColumns.length > 0) {
        throw new Error(`Incomplete offers schema: missing ${missingColumns.join(", ")}`);
      }
      this.connection.exec(CREATE_INDEXES_SQL);
      return;
    }
    if (primaryKey?.name !== LEGACY_PRIMARY_KEY_COLUMN) {
      throw new Error("Unsupported offers schema: migration cannot preserve it safely");
    }
    this.migrateLegacyRows();
  }

  /**
   * Rebuild the legacy dedup-key table without discarding existing rows.
   * @returns {void}
   */
  migrateLegacyRows() {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const legacyRows = this.connection.prepare("SELECT * FROM offers").all();
      this.connection.exec("ALTER TABLE offers RENAME TO offers_legacy");
      this.connection.exec(CREATE_TABLE_SQL);
      const insert = this.connection.prepare(INSERT_SQL);
      for (const row of legacyRows) {
        const migrated = this.buildLegacyObservation(row);
        insert.run(
          migrated.source,
          migrated.sourceId,
          migrated.identityKind,
          migrated.surrogateKey,
          migrated.payload,
          row.first_seen_at,
          row.last_seen_at,
          row.dedup_key,
        );
      }
      this.connection.exec("DROP TABLE offers_legacy");
      this.connection.exec(CREATE_INDEXES_SQL);
      this.connection.exec("COMMIT");
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Classify and enrich one legacy observation from its persisted payload.
   * @param {object} row - Historical SQLite row.
   * @returns {object} Values for the target schema.
   */
  buildLegacyObservation(row) {
    const payload = JSON.parse(row.payload);
    delete payload.id;
    payload.source = row.source;
    payload.sourceId = row.source_id ?? payload.sourceId ?? null;
    const isCareerjet = row.source === JobSource.CAREERJET;
    if (!isCareerjet && !STABLE_SOURCES.has(row.source)) {
      throw new Error(`Unsupported legacy offer source: ${row.source}`);
    }
    payload.identityKind = isCareerjet
      ? OfferIdentityKind.SURROGATE
      : OfferIdentityKind.STABLE;
    if (!isCareerjet && (!payload.sourceId || !String(payload.sourceId).trim())) {
      throw new Error(`Legacy stable offer requires a sourceId: ${row.source}`);
    }
    if (isCareerjet) {
      const surrogate = CareerjetSurrogateIdentity.build({
        title: payload.title,
        company: payload.company?.name,
        city: payload.location?.city,
        locationLabel: payload.location?.label,
        publishedAt: payload.publishedAt ?? row.published_at,
        description: payload.description,
      });
      payload.surrogateKey = surrogate.surrogateKey;
      payload.surrogateMatchable = surrogate.surrogateMatchable;
    } else {
      payload.surrogateKey = null;
      payload.surrogateMatchable = false;
    }
    return {
      source: payload.source,
      sourceId: payload.sourceId,
      identityKind: payload.identityKind,
      surrogateKey: payload.surrogateKey,
      payload: JSON.stringify(payload),
    };
  }

  /**
   * Insert or refresh every offer in a single transaction.
   * @param {import("../models/JobOffer.js").JobOffer[]} offers - Provider observations.
   * @returns {import("../models/JobOffer.js").JobOffer[]} Persisted observations with ids.
   */
  upsertMany(offers) {
    const now = new Date().toISOString();
    const persisted = [];
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      for (const offer of offers) {
        persisted.push(this.upsertOne(offer, now));
      }
      this.connection.exec("COMMIT");
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
    return persisted;
  }

  /**
   * Insert or refresh one observation according to its identity strategy.
   * @param {import("../models/JobOffer.js").JobOffer} offer - Provider observation.
   * @param {string} [now] - Shared transaction timestamp.
   * @returns {import("../models/JobOffer.js").JobOffer} Persisted observation with id.
   */
  upsertOne(offer, now = new Date().toISOString()) {
    this.validateIdentityPolicy(offer);
    if (offer.identityKind === OfferIdentityKind.STABLE) {
      const existing = this.selectStableStatement.get(offer.source, offer.sourceId);
      return existing ? this.update(existing, offer, now) : this.insert(offer, now);
    }
    if (!offer.surrogateMatchable) {
      return this.insert(offer, now);
    }
    const candidates = this.selectSurrogateStatement.all(offer.source, offer.surrogateKey);
    return candidates.length === 1
      ? this.update(candidates[0], offer, now)
      : this.insert(offer, now);
  }

  /**
   * Enforce the supported provider identity policy before any database write.
   * @param {import("../models/JobOffer.js").JobOffer} offer - Provider observation.
   * @returns {void}
   */
  validateIdentityPolicy(offer) {
    if (offer.identityKind === OfferIdentityKind.STABLE) {
      if (!STABLE_SOURCES.has(offer.source)) {
        throw new TypeError(`Source does not support stable identity: ${offer.source}`);
      }
      if (!offer.sourceId || !String(offer.sourceId).trim()) {
        throw new TypeError("A stable offer requires a non-empty sourceId");
      }
      return;
    }
    if (offer.identityKind === OfferIdentityKind.SURROGATE) {
      if (offer.source !== JobSource.CAREERJET) {
        throw new TypeError(`Source does not support surrogate identity: ${offer.source}`);
      }
      return;
    }
    throw new TypeError(`Unsupported offer identity kind: ${offer.identityKind}`);
  }

  /**
   * Insert an observation and hydrate it from its SQLite row.
   * @param {import("../models/JobOffer.js").JobOffer} offer - Provider observation.
   * @param {string} now - Current timestamp.
   * @returns {import("../models/JobOffer.js").JobOffer} Persisted observation.
   */
  insert(offer, now) {
    const payload = this.serialize(offer);
    const result = this.insertStatement.run(
      offer.source,
      offer.sourceId ?? null,
      offer.identityKind,
      offer.surrogateKey ?? null,
      payload,
      now,
      now,
      offer.getDeduplicationKey(),
    );
    return this.findById(Number(result.lastInsertRowid));
  }

  /**
   * Update one identified row while retaining its id and first-seen timestamp.
   * @param {object} existing - Existing SQLite row.
   * @param {import("../models/JobOffer.js").JobOffer} offer - Fresh observation.
   * @param {string} now - Current timestamp.
   * @returns {import("../models/JobOffer.js").JobOffer} Persisted observation.
   */
  update(existing, offer, now) {
    const existingOffer = this.hydrateRow(existing);
    const mergedOffer = new JobOffer({
      ...offer,
      offerContent: existingOffer.offerContent.merge(offer.offerContent),
    });
    const payload = this.serialize(mergedOffer);
    this.updateStatement.run(
      offer.sourceId ?? null,
      offer.surrogateKey ?? null,
      payload,
      now,
      offer.getDeduplicationKey(),
      existing.id,
    );
    return this.findById(existing.id);
  }

  /**
   * Load one persisted observation using SQLite columns as identity authority.
   * @param {number} id - Internal SQLite identifier.
   * @returns {import("../models/JobOffer.js").JobOffer|null} Persisted observation when found.
   */
  findById(id) {
    const row = this.selectIdStatement.get(id);
    if (!row) {
      return null;
    }
    return this.hydrateRow(row);
  }

  /**
   * Merge trusted incoming content into exactly one persisted observation.
   * @param {number} id - Internal SQLite identifier.
   * @param {import("../models/OfferContent.js").OfferContent} incomingContent - Trusted content.
   * @returns {import("../models/JobOffer.js").JobOffer|null} Enriched observation when found.
   */
  enrichContentById(id, incomingContent) {
    const existing = this.findById(id);
    if (!existing) {
      return null;
    }
    const enriched = new JobOffer({
      ...existing,
      offerContent: existing.offerContent.merge(incomingContent),
    });
    this.updateContentStatement.run(this.serialize(enriched), id);
    return this.findById(id);
  }

  /**
   * Explicitly replace user text while preserving identity, provider content and seen timestamps.
   * @param {number} id - Internal SQLite identifier.
   * @param {string} value - Validated user-provided text.
   * @param {string} providedAt - Server-generated submission timestamp.
   * @returns {import("../models/JobOffer.js").JobOffer|null} Updated or unchanged observation.
   */
  replaceUserTextById(id, value, providedAt) {
    const existing = this.findById(id);
    if (!existing) {
      return null;
    }
    if (existing.offerContent.userText?.value === value) {
      return existing;
    }
    const updated = new JobOffer({
      ...existing,
      offerContent: existing.offerContent.withUserText(value, providedAt),
    });
    this.updateContentStatement.run(this.serialize(updated), id);
    return this.findById(id);
  }

  /**
   * Hydrate one SQLite row using its columns as identity authority.
   * @param {object} row - SQLite offer row.
   * @returns {import("../models/JobOffer.js").JobOffer} Hydrated observation.
   */
  hydrateRow(row) {
    const payload = JSON.parse(row.payload);
    payload.source = row.source;
    payload.sourceId = row.source_id;
    payload.identityKind = row.identity_kind;
    payload.surrogateKey = row.surrogate_key;
    return JobOffer.fromPersistence(row.id, payload);
  }

  /**
   * Serialize an observation without duplicating its SQLite identity.
   * @param {import("../models/JobOffer.js").JobOffer} offer - Observation to serialize.
   * @returns {string} JSON payload.
   */
  serialize(offer) {
    const payload = offer.toPersistenceJson();
    delete payload.id;
    return JSON.stringify(payload);
  }
}

export { OfferRepository };
