import test from "node:test";
import assert from "node:assert/strict";
import { Database } from "../../src/persistence/Database.js";
import { OfferRepository } from "../../src/persistence/OfferRepository.js";
import { JobOffer } from "../../src/models/JobOffer.js";
import { Company } from "../../src/models/Company.js";
import { JobLocation } from "../../src/models/JobLocation.js";
import { Salary } from "../../src/models/Salary.js";
import { JobSource } from "../../src/constants/JobSource.js";
import { OfferIdentityKind } from "../../src/constants/OfferIdentityKind.js";
import { CareerjetSurrogateIdentity } from "../../src/identity/CareerjetSurrogateIdentity.js";
import { OfferContent } from "../../src/models/OfferContent.js";
import { OfferContentAcquisition } from "../../src/constants/OfferContentAcquisition.js";
import { OfferContentCompleteness } from "../../src/constants/OfferContentCompleteness.js";

const FIRST_SEEN = "2026-08-01T10:00:00.000Z";
const LAST_SEEN = "2026-08-02T10:00:00.000Z";
const NEXT_SEEN = "2026-08-03T10:00:00.000Z";
const LEGACY_ID_IN_PAYLOAD = 999;
const TWO_ROWS = 2;
const THREE_ROWS = 3;
const FIVE_ROWS = 5;
const EXPECTED_TARGET_INDEXES = new Set([
  "idx_offers_first_seen",
  "idx_offers_stable_identity",
  "idx_offers_surrogate",
  "idx_offers_dedup",
]);

const LEGACY_SCHEMA_SQL = `
  CREATE TABLE offers (
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
  CREATE INDEX idx_offers_first_seen ON offers(first_seen_at)
`;

/**
 * Create an isolated database carrying the exact historical offers schema.
 * @returns {{database: Database, connection: import("node:sqlite").DatabaseSync}} Test context.
 */
function createLegacyDatabase() {
  const database = new Database(":memory:");
  const connection = database.getConnection();
  connection.exec(LEGACY_SCHEMA_SQL);
  return { database, connection };
}

/**
 * Insert one row into a historical offers table.
 * @param {import("node:sqlite").DatabaseSync} connection - Test database connection.
 * @param {object} params - Historical row values.
 * @param {string} params.dedupKey - Historical primary key.
 * @param {string} params.source - Provider source.
 * @param {string|null} params.sourceId - Historical provider identifier.
 * @param {object} params.payload - Historical serialized offer.
 * @returns {void}
 */
function insertLegacyRow(connection, { dedupKey, source, sourceId, payload }) {
  connection.prepare(`
    INSERT INTO offers
      (dedup_key, source, source_id, payload, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(dedupKey, source, sourceId, JSON.stringify(payload), FIRST_SEEN, LAST_SEEN);
}

/**
 * Assert that a failed migration left the historical table and its rows intact.
 * @param {import("node:sqlite").DatabaseSync} connection - Test database connection.
 * @param {number} expectedRows - Expected historical row count.
 * @returns {void}
 */
function assertLegacyTableIntact(connection, expectedRows) {
  const columns = connection.prepare("PRAGMA table_info(offers)").all();
  const primaryKey = columns.find((column) => {
    return column.pk === 1;
  });
  const rowCount = connection.prepare("SELECT COUNT(*) count FROM offers").get().count;

  assert.equal(primaryKey.name, "dedup_key");
  assert.equal(rowCount, expectedRows);
}

/**
 * Create an isolated in-memory repository.
 * @returns {{connection: import("node:sqlite").DatabaseSync, repository: OfferRepository}} Test context.
 */
function createRepository() {
  const database = new Database(":memory:");
  return {
    connection: database.getConnection(),
    repository: new OfferRepository(database),
  };
}

/**
 * Build a provider observation with overridable identity and content fields.
 * @param {object} [overrides] - Values replacing the defaults.
 * @returns {JobOffer} Provider observation.
 */
function createOffer(overrides = {}) {
  return new JobOffer({
    source: JobSource.ADZUNA,
    sourceId: "adzuna-1",
    identityKind: OfferIdentityKind.STABLE,
    title: "Developer",
    description: "A complete description",
    company: new Company({ name: "Example" }),
    location: new JobLocation({ city: "Annecy", label: "Annecy" }),
    salary: new Salary({}),
    publishedAt: FIRST_SEEN,
    applyUrl: "https://example.com/first",
    ...overrides,
  });
}

/**
 * Build provider content for repository merge scenarios.
 * @param {object} [overrides] - Values replacing the automatic text defaults.
 * @returns {OfferContent} Test content.
 */
function createContent(overrides = {}) {
  return new OfferContent({
    automaticText: {
      value: "Provider text",
      acquisition: OfferContentAcquisition.SEARCH,
      retrievedAt: FIRST_SEEN,
      completeness: OfferContentCompleteness.UNKNOWN,
      ...overrides,
    },
  });
}

/**
 * Build a Careerjet observation whose surrogate excludes its URL.
 * @param {object} [overrides] - Values replacing the defaults.
 * @returns {JobOffer} Careerjet observation.
 */
function createCareerjetOffer(overrides = {}) {
  const values = {
    sourceId: "https://example.com/careerjet/first",
    title: "Developer",
    description: "A complete description",
    company: new Company({ name: "Example" }),
    location: new JobLocation({ city: "Annecy", label: "Annecy" }),
    publishedAt: FIRST_SEEN,
    ...overrides,
  };
  const surrogate = CareerjetSurrogateIdentity.build({
    title: values.title,
    company: values.company?.name,
    city: values.location?.city,
    locationLabel: values.location?.label,
    publishedAt: values.publishedAt,
    description: values.description,
  });
  return createOffer({
    ...values,
    source: JobSource.CAREERJET,
    identityKind: OfferIdentityKind.SURROGATE,
    surrogateKey: surrogate.surrogateKey,
    surrogateMatchable: surrogate.surrogateMatchable,
    applyUrl: values.sourceId,
  });
}

test("stable upserts return hydrated ids and retain identity across content changes", () => {
  const { connection, repository } = createRepository();
  const inserted = repository.upsertOne(createOffer(), FIRST_SEEN);
  const updated = repository.upsertOne(createOffer({
    title: "Senior Developer",
    location: new JobLocation({ city: "Lyon" }),
  }), LAST_SEEN);
  const row = connection.prepare("SELECT * FROM offers").get();

  assert.equal(typeof inserted.id, "number");
  assert.equal(updated.id, inserted.id);
  assert.equal(row.first_seen_at, FIRST_SEEN);
  assert.equal(row.last_seen_at, LAST_SEEN);
  assert.equal(JSON.parse(row.payload).id, undefined);
  connection.close();
});

test("distinct stable source ids can share a deduplication key", () => {
  const { connection, repository } = createRepository();
  const persisted = repository.upsertMany([
    createOffer({ sourceId: "adzuna-1" }),
    createOffer({ sourceId: "adzuna-2" }),
  ]);

  assert.equal(persisted.length, TWO_ROWS);
  assert.notEqual(persisted[0].id, persisted[1].id);
  assert.equal(connection.prepare("SELECT COUNT(*) count FROM offers").get().count, TWO_ROWS);
  connection.close();
});

test("the database independently rejects duplicate stable identities", () => {
  const { connection, repository } = createRepository();
  repository.upsertOne(createOffer(), FIRST_SEEN);
  const row = connection.prepare("SELECT * FROM offers").get();

  assert.throws(() => {
    connection.prepare(`
      INSERT INTO offers
        (source, source_id, identity_kind, surrogate_key, payload, first_seen_at, last_seen_at, dedup_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.source,
      row.source_id,
      row.identity_kind,
      row.surrogate_key,
      row.payload,
      row.first_seen_at,
      row.last_seen_at,
      row.dedup_key,
    );
  }, /UNIQUE constraint failed/);
  connection.close();
});

test("supported sources accept only their documented identity strategy", () => {
  const stableSources = [
    JobSource.FRANCE_TRAVAIL,
    JobSource.ADZUNA,
    JobSource.HELLOWORK,
  ];
  for (const source of stableSources) {
    const { connection, repository } = createRepository();
    const persisted = repository.upsertOne(createOffer({
      source,
      sourceId: `${source}-id`,
    }), FIRST_SEEN);

    assert.equal(typeof persisted.id, "number");
    assert.equal(connection.prepare("SELECT COUNT(*) count FROM offers").get().count, 1);
    connection.close();
  }

  const { connection, repository } = createRepository();
  const persisted = repository.upsertOne(createCareerjetOffer(), FIRST_SEEN);

  assert.equal(typeof persisted.id, "number");
  assert.equal(connection.prepare("SELECT COUNT(*) count FROM offers").get().count, 1);
  connection.close();
});

test("unsupported source and identity combinations are rejected without writes", () => {
  const rejectedOffers = [
    createOffer({ source: JobSource.CAREERJET }),
    createOffer({
      identityKind: OfferIdentityKind.SURROGATE,
      surrogateKey: "adzuna-surrogate",
      surrogateMatchable: true,
    }),
    createOffer({ source: JobSource.ATS }),
    createOffer({ source: "arbitrary-provider" }),
    createOffer({
      source: "arbitrary-provider",
      identityKind: OfferIdentityKind.SURROGATE,
      surrogateKey: "arbitrary-surrogate",
      surrogateMatchable: true,
    }),
  ];
  for (const offer of rejectedOffers) {
    const { connection, repository } = createRepository();

    assert.throws(() => {
      return repository.upsertOne(offer, FIRST_SEEN);
    }, /Source does not support/);
    assert.equal(connection.prepare("SELECT COUNT(*) count FROM offers").get().count, 0);
    connection.close();
  }
});

test("upsertMany rolls back valid writes when a later identity policy is rejected", () => {
  const { connection, repository } = createRepository();

  assert.throws(() => {
    return repository.upsertMany([
      createOffer(),
      createOffer({ source: JobSource.CAREERJET }),
    ]);
  }, /Source does not support stable identity/);
  assert.equal(connection.prepare("SELECT COUNT(*) count FROM offers").get().count, 0);
  connection.close();
});

test("Careerjet updates one unique match despite a rotated URL", () => {
  const { connection, repository } = createRepository();
  const inserted = repository.upsertOne(createCareerjetOffer(), FIRST_SEEN);
  const updated = repository.upsertOne(createCareerjetOffer({
    sourceId: "https://example.com/careerjet/rotated",
  }), LAST_SEEN);
  const row = connection.prepare("SELECT * FROM offers").get();

  assert.equal(updated.id, inserted.id);
  assert.equal(updated.sourceId, "https://example.com/careerjet/rotated");
  assert.equal(row.first_seen_at, FIRST_SEEN);
  assert.equal(row.last_seen_at, LAST_SEEN);
  connection.close();
});

test("Careerjet unique surrogate update preserves richer OfferContent", () => {
  const { connection, repository } = createRepository();
  const inserted = repository.upsertOne(createCareerjetOffer({
    offerContent: createContent({
      completeness: OfferContentCompleteness.PROVIDER_FULL,
    }),
  }), FIRST_SEEN);
  const updated = repository.upsertOne(createCareerjetOffer({
    sourceId: "https://example.com/careerjet/rotated-content",
    offerContent: createContent({
      retrievedAt: LAST_SEEN,
      completeness: OfferContentCompleteness.KNOWN_TRUNCATED,
    }),
  }), LAST_SEEN);
  const row = connection.prepare("SELECT * FROM offers WHERE id = ?").get(inserted.id);

  assert.equal(updated.id, inserted.id);
  assert.equal(
    updated.offerContent.automaticText.completeness,
    OfferContentCompleteness.PROVIDER_FULL,
  );
  assert.equal(row.first_seen_at, FIRST_SEEN);
  assert.equal(row.last_seen_at, LAST_SEEN);
  assert.equal(connection.prepare("SELECT COUNT(*) count FROM offers").get().count, 1);
  connection.close();
});

test("Careerjet fragment transition conservatively inserts a second observation", () => {
  const { connection, repository } = createRepository();
  const short = repository.upsertOne(createCareerjetOffer({
    description: "Fragment court",
    offerContent: createContent({
      value: "Fragment court",
      completeness: OfferContentCompleteness.KNOWN_TRUNCATED,
    }),
  }), FIRST_SEEN);
  const rich = repository.upsertOne(createCareerjetOffer({
    description: "Fragment court avec une description beaucoup plus riche",
    offerContent: createContent({
      value: "Fragment court avec une description beaucoup plus riche",
      completeness: OfferContentCompleteness.UNKNOWN,
      retrievedAt: LAST_SEEN,
    }),
  }), LAST_SEEN);

  assert.notEqual(short.surrogateKey, rich.surrogateKey);
  assert.notEqual(short.id, rich.id);
  assert.equal(connection.prepare("SELECT COUNT(*) count FROM offers").get().count, TWO_ROWS);
  connection.close();
});

test("non-matchable and ambiguous Careerjet observations always insert", () => {
  const { connection, repository } = createRepository();
  const incomplete = createCareerjetOffer({ company: new Company({ name: null }) });
  const firstIncomplete = repository.upsertOne(incomplete, FIRST_SEEN);
  const secondIncomplete = repository.upsertOne(incomplete, LAST_SEEN);
  const matchable = createCareerjetOffer();
  const firstMatchable = repository.upsertOne(matchable, FIRST_SEEN);
  connection.prepare(`
    INSERT INTO offers
      (source, source_id, identity_kind, surrogate_key, payload, first_seen_at, last_seen_at, dedup_key)
    SELECT source, source_id, identity_kind, surrogate_key, payload, first_seen_at, last_seen_at, dedup_key
    FROM offers WHERE id = ?
  `).run(firstMatchable.id);
  const ambiguous = repository.upsertOne(matchable, NEXT_SEEN);

  assert.notEqual(firstIncomplete.id, secondIncomplete.id);
  assert.notEqual(ambiguous.id, firstMatchable.id);
  assert.equal(connection.prepare("SELECT COUNT(*) count FROM offers").get().count, FIVE_ROWS);
  connection.close();
});

test("legacy schema migration preserves rows, timestamps and provider classification", () => {
  const { database, connection } = createLegacyDatabase();
  const sources = [JobSource.FRANCE_TRAVAIL, JobSource.ADZUNA, JobSource.HELLOWORK];
  for (const source of sources) {
    const offer = createOffer({ source, sourceId: `${source}-id` });
    insertLegacyRow(connection, {
      dedupKey: source,
      source,
      sourceId: offer.sourceId,
      payload: { ...offer.toJson(), id: LEGACY_ID_IN_PAYLOAD },
    });
  }
  const careerjet = createCareerjetOffer();
  insertLegacyRow(connection, {
    dedupKey: "careerjet-complete",
    source: JobSource.CAREERJET,
    sourceId: careerjet.sourceId,
    payload: {
      ...careerjet.toJson(),
      identityKind: undefined,
      surrogateKey: undefined,
      surrogateMatchable: undefined,
    },
  });
  const incomplete = createCareerjetOffer({ description: null });
  insertLegacyRow(connection, {
    dedupKey: "careerjet-incomplete",
    source: JobSource.CAREERJET,
    sourceId: incomplete.sourceId,
    payload: {
      ...incomplete.toJson(),
      identityKind: undefined,
      surrogateKey: undefined,
      surrogateMatchable: undefined,
    },
  });

  const repository = new OfferRepository(database);
  const rows = connection.prepare("SELECT * FROM offers ORDER BY id").all();
  const stableRows = rows.filter((row) => {
    return row.identity_kind === OfferIdentityKind.STABLE;
  });
  const careerjetRows = rows.filter((row) => {
    return row.source === JobSource.CAREERJET;
  });

  assert.ok(repository);
  assert.equal(rows.length, FIVE_ROWS);
  assert.equal(stableRows.length, THREE_ROWS);
  assert.equal(careerjetRows.length, TWO_ROWS);
  assert.equal(JSON.parse(rows[0].payload).id, undefined);
  assert.equal(careerjetRows[0].identity_kind, OfferIdentityKind.SURROGATE);
  assert.equal(JSON.parse(careerjetRows[0].payload).surrogateMatchable, true);
  assert.equal(JSON.parse(careerjetRows[1].payload).surrogateMatchable, false);
  assert.equal(rows[0].first_seen_at, FIRST_SEEN);
  assert.equal(rows[0].last_seen_at, LAST_SEEN);
  const indexNames = new Set(connection.prepare("PRAGMA index_list(offers)").all().map((index) => {
    return index.name;
  }));
  for (const indexName of EXPECTED_TARGET_INDEXES) {
    assert.equal(indexNames.has(indexName), true);
  }
  connection.close();
});

test("invalid legacy stable identities roll back without changing historical data", () => {
  const invalidSourceIds = [null, "", "   "];
  for (const sourceId of invalidSourceIds) {
    const { database, connection } = createLegacyDatabase();
    const offer = createOffer({ sourceId });
    insertLegacyRow(connection, {
      dedupKey: `invalid-${String(sourceId)}`,
      source: JobSource.ADZUNA,
      sourceId,
      payload: offer.toJson(),
    });

    assert.throws(() => {
      return new OfferRepository(database);
    }, /Legacy stable offer requires a sourceId/);
    assertLegacyTableIntact(connection, 1);
    connection.close();
  }
});

test("legacy stable collisions roll back after target table reconstruction", () => {
  const { database, connection } = createLegacyDatabase();
  const offer = createOffer({ sourceId: "shared-id" });
  insertLegacyRow(connection, {
    dedupKey: "first-dedup-key",
    source: JobSource.ADZUNA,
    sourceId: offer.sourceId,
    payload: offer.toJson(),
  });
  insertLegacyRow(connection, {
    dedupKey: "second-dedup-key",
    source: JobSource.ADZUNA,
    sourceId: offer.sourceId,
    payload: offer.toJson(),
  });

  assert.throws(() => {
    return new OfferRepository(database);
  }, /UNIQUE constraint failed/);
  assertLegacyTableIntact(connection, TWO_ROWS);
  connection.close();
});

test("unknown legacy sources roll back without changing historical data", () => {
  const { database, connection } = createLegacyDatabase();
  const offer = createOffer({ source: "unknown-provider" });
  insertLegacyRow(connection, {
    dedupKey: "unknown-provider-key",
    source: offer.source,
    sourceId: offer.sourceId,
    payload: offer.toJson(),
  });

  assert.throws(() => {
    return new OfferRepository(database);
  }, /Unsupported legacy offer source/);
  assertLegacyTableIntact(connection, 1);
  connection.close();
});

test("legacy ATS rows roll back without changing historical data", () => {
  const { database, connection } = createLegacyDatabase();
  const offer = createOffer({ source: JobSource.ATS });
  insertLegacyRow(connection, {
    dedupKey: "ats-provider-key",
    source: offer.source,
    sourceId: offer.sourceId,
    payload: offer.toJson(),
  });

  assert.throws(() => {
    return new OfferRepository(database);
  }, /Unsupported legacy offer source: ats/);
  assertLegacyTableIntact(connection, 1);
  connection.close();
});

test("an incomplete id-primary-key schema is rejected explicitly", () => {
  const database = new Database(":memory:");
  const connection = database.getConnection();
  connection.exec("CREATE TABLE offers (id INTEGER PRIMARY KEY, source TEXT NOT NULL)");

  assert.throws(() => {
    return new OfferRepository(database);
  }, /Incomplete offers schema/);
  connection.close();
});

test("repository hydration uses SQLite identity columns over the payload", () => {
  const { connection, repository } = createRepository();
  const inserted = repository.upsertOne(createOffer(), FIRST_SEEN);
  const row = connection.prepare("SELECT payload FROM offers WHERE id = ?").get(inserted.id);
  const payload = JSON.parse(row.payload);
  payload.id = LEGACY_ID_IN_PAYLOAD;
  payload.sourceId = "contradictory-payload-id";
  connection.prepare("UPDATE offers SET payload = ? WHERE id = ?").run(
    JSON.stringify(payload),
    inserted.id,
  );
  const hydrated = repository.findById(inserted.id);

  assert.equal(hydrated.id, inserted.id);
  assert.equal(hydrated.sourceId, inserted.sourceId);
  connection.close();
});

test("repository inserts persistent OfferContent without exposing SQLite id in payload", () => {
  const { connection, repository } = createRepository();
  const persisted = repository.upsertOne(createOffer({
    offerContent: createContent({ value: "Inserted text" }),
  }), FIRST_SEEN);
  const row = connection.prepare("SELECT payload FROM offers WHERE id = ?").get(persisted.id);
  const payload = JSON.parse(row.payload);

  assert.equal(payload.offerContent.automaticText.value, "Inserted text");
  assert.equal(payload.description, "Inserted text");
  assert.equal(payload.id, undefined);
  connection.close();
});

test("repository preserves richer text from a newer poorer observation", () => {
  const { connection, repository } = createRepository();
  const inserted = repository.upsertOne(createOffer({
    offerContent: createContent({
      value: "Full text",
      completeness: OfferContentCompleteness.PROVIDER_FULL,
    }),
  }), FIRST_SEEN);
  const updated = repository.upsertOne(createOffer({
    title: "Updated title",
    offerContent: createContent({
      value: "New truncated text",
      retrievedAt: LAST_SEEN,
      completeness: OfferContentCompleteness.KNOWN_TRUNCATED,
    }),
  }), LAST_SEEN);
  const row = connection.prepare("SELECT * FROM offers WHERE id = ?").get(inserted.id);

  assert.equal(updated.id, inserted.id);
  assert.equal(updated.title, "Updated title");
  assert.equal(updated.description, "Full text");
  assert.equal(row.first_seen_at, FIRST_SEEN);
  assert.equal(row.last_seen_at, LAST_SEEN);
  connection.close();
});

test("repository adopts richer text from a poorer persisted observation", () => {
  const { connection, repository } = createRepository();
  const inserted = repository.upsertOne(createOffer({
    offerContent: createContent({
      value: "Truncated text",
      completeness: OfferContentCompleteness.KNOWN_TRUNCATED,
    }),
  }), FIRST_SEEN);
  const updated = repository.upsertOne(createOffer({
    offerContent: createContent({
      value: "Full text",
      retrievedAt: LAST_SEEN,
      completeness: OfferContentCompleteness.PROVIDER_FULL,
    }),
  }), LAST_SEEN);

  assert.equal(updated.id, inserted.id);
  assert.equal(updated.description, "Full text");
  connection.close();
});

test("repository applies freshness at equal rank and rejects empty incoming text", () => {
  const { connection, repository } = createRepository();
  const inserted = repository.upsertOne(createOffer({
    offerContent: createContent({ value: "First text" }),
  }), FIRST_SEEN);
  const newer = repository.upsertOne(createOffer({
    offerContent: createContent({ value: "Second text", retrievedAt: LAST_SEEN }),
  }), LAST_SEEN);
  const empty = repository.upsertOne(createOffer({
    offerContent: createContent({ value: " ", retrievedAt: NEXT_SEEN }),
  }), NEXT_SEEN);

  assert.equal(newer.description, "Second text");
  assert.equal(empty.description, "Second text");
  assert.equal(empty.id, inserted.id);
  connection.close();
});

test("reading a legacy payload hydrates content without rewriting the row", () => {
  const { connection, repository } = createRepository();
  const inserted = repository.upsertOne(createOffer(), FIRST_SEEN);
  const row = connection.prepare("SELECT payload FROM offers WHERE id = ?").get(inserted.id);
  const legacyPayload = JSON.parse(row.payload);
  delete legacyPayload.offerContent;
  const serializedLegacy = JSON.stringify(legacyPayload);
  connection.prepare("UPDATE offers SET payload = ? WHERE id = ?").run(
    serializedLegacy,
    inserted.id,
  );

  const hydrated = repository.findById(inserted.id);
  const afterRead = connection.prepare("SELECT payload FROM offers WHERE id = ?").get(inserted.id);

  assert.equal(hydrated.description, legacyPayload.description);
  assert.equal(
    hydrated.offerContent.automaticText.completeness,
    OfferContentCompleteness.KNOWN_TRUNCATED,
  );
  assert.equal(afterRead.payload, serializedLegacy);
  connection.close();
});

test("content enrichment targets one id and preserves observation metadata", () => {
  const { connection, repository } = createRepository();
  const inserted = repository.upsertOne(createOffer({
    source: JobSource.HELLOWORK,
    sourceId: "hellowork-1",
    applyUrl: "https://www.hellowork.com/fr-fr/emplois/offer.html",
    offerContent: new OfferContent(),
  }), FIRST_SEEN);
  const before = connection.prepare("SELECT * FROM offers WHERE id = ?").get(inserted.id);
  const enriched = repository.enrichContentById(inserted.id, new OfferContent({
    automaticText: {
      value: "Description DETAIL",
      acquisition: OfferContentAcquisition.DETAIL,
      completeness: OfferContentCompleteness.PROVIDER_FULL,
      retrievedAt: LAST_SEEN,
    },
  }));
  const after = connection.prepare("SELECT * FROM offers WHERE id = ?").get(inserted.id);

  assert.equal(enriched.id, inserted.id);
  assert.equal(enriched.description, "Description DETAIL");
  assert.equal(after.first_seen_at, before.first_seen_at);
  assert.equal(after.last_seen_at, before.last_seen_at);
  assert.equal(after.source, before.source);
  assert.equal(after.source_id, before.source_id);
  assert.equal(after.identity_kind, before.identity_kind);
  assert.equal(after.surrogate_key, before.surrogate_key);
  assert.equal(after.dedup_key, before.dedup_key);
  connection.close();
});

test("content enrichment reuses merge and missing ids never write", () => {
  const { connection, repository } = createRepository();
  const inserted = repository.upsertOne(createOffer({
    offerContent: createContent({
      value: "Existing complete text",
      completeness: OfferContentCompleteness.PROVIDER_FULL,
    }),
  }), FIRST_SEEN);
  const preserved = repository.enrichContentById(inserted.id, createContent({
    value: "Incoming truncated text",
    completeness: OfferContentCompleteness.KNOWN_TRUNCATED,
    retrievedAt: LAST_SEEN,
  }));
  const changesBeforeMissing = connection.prepare("SELECT total_changes() changes").get().changes;
  const missing = repository.enrichContentById(LEGACY_ID_IN_PAYLOAD, createContent());
  const changesAfterMissing = connection.prepare("SELECT total_changes() changes").get().changes;

  assert.equal(preserved.description, "Existing complete text");
  assert.equal(missing, null);
  assert.equal(changesAfterMissing, changesBeforeMissing);
  connection.close();
});

test("HelloWork SEARCH without text cannot overwrite persisted DETAIL content", () => {
  const { connection, repository } = createRepository();
  const detail = repository.upsertOne(createOffer({
    source: JobSource.HELLOWORK,
    sourceId: "hellowork-persisted-detail",
    offerContent: new OfferContent({
      automaticText: {
        value: "Persisted DETAIL",
        acquisition: OfferContentAcquisition.DETAIL,
        completeness: OfferContentCompleteness.PROVIDER_FULL,
        retrievedAt: FIRST_SEEN,
      },
    }),
  }), FIRST_SEEN);
  const refreshed = repository.upsertOne(createOffer({
    source: JobSource.HELLOWORK,
    sourceId: "hellowork-persisted-detail",
    offerContent: new OfferContent(),
  }), LAST_SEEN);

  assert.equal(refreshed.id, detail.id);
  assert.equal(refreshed.description, "Persisted DETAIL");
  connection.close();
});
