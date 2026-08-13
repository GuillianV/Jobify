import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { OfferAnalysis } from "../../src/models/OfferAnalysis.js";
import { OfferAnalysisRepository } from "../../src/persistence/OfferAnalysisRepository.js";
import { OfferAnalysisCacheIdentity } from "../../src/services/OfferAnalysisCacheIdentity.js";

const OFFER_ID = 42;
const OTHER_OFFER_ID = 43;
const CONFIGURED_MAX_OUTPUT_TOKENS = 4096;
const EFFECTIVE_MAX_OUTPUT_TOKENS = 3072;
const OTHER_EFFECTIVE_MAX_OUTPUT_TOKENS = 2048;
const ANALYZED_AT = "2026-08-13T10:00:00.000Z";
const OTHER_ANALYZED_AT = "2026-08-13T11:00:00.000Z";

/**
 * Create one isolated in-memory repository and its inspectable SQLite connection.
 * @returns {{connection: DatabaseSync, repository: OfferAnalysisRepository}} Test context.
 */
function createRepository() {
  const connection = new DatabaseSync(":memory:");
  const database = {
    getConnection() {
      return connection;
    },
  };
  return {
    connection,
    repository: new OfferAnalysisRepository(database),
  };
}

/**
 * Build one exact immutable cache identity with optional component overrides.
 * @param {object} [overrides] - Identity component replacements.
 * @returns {Readonly<object>} Cache identity.
 */
function createIdentity(overrides = {}) {
  return OfferAnalysisCacheIdentity.build({
    offerId: OFFER_ID,
    contentFingerprint: "content-fingerprint",
    deterministicInputFingerprint: "input-fingerprint",
    policyVersion: "offer-analyzer-v5",
    schemaVersion: "offer-analysis-schema-v1",
    llmProvider: "GROQ",
    model: "model-a",
    configuredMaxOutputTokens: CONFIGURED_MAX_OUTPUT_TOKENS,
    ...overrides,
  });
}

/**
 * Serialize one small official OfferAnalysis payload for persistence tests.
 * @param {string} value - Synthetic activity value.
 * @returns {object} Detached OfferAnalysis JSON.
 */
function createAnalysisPayload(value = "Build services") {
  return new OfferAnalysis({
    seniority: null,
    activities: [{ value, assertion: "INFERRED", evidence: null }],
    requirements: [],
    context: [],
    workConditions: { workMode: null, constraints: [] },
  }).toJson();
}

/**
 * Build one complete persistable record.
 * @param {object} [overrides] - Record replacements.
 * @returns {object} Repository insert record.
 */
function createRecord(overrides = {}) {
  return {
    identity: createIdentity(),
    analysisPayload: createAnalysisPayload(),
    effectiveMaxOutputTokens: EFFECTIVE_MAX_OUTPUT_TOKENS,
    analyzedAt: ANALYZED_AT,
    ...overrides,
  };
}

test("constructor creates the minimal table without foreign keys or extra indexes", () => {
  const { connection } = createRepository();
  try {
    const table = connection.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get("offer_analyses");
    const foreignKeys = connection.prepare("PRAGMA foreign_key_list(offer_analyses)").all();
    const indexes = connection.prepare("PRAGMA index_list(offer_analyses)").all();

    assert.equal(table.name, "offer_analyses");
    assert.deepEqual(foreignKeys, []);
    assert.equal(indexes.length, 1);
    assert.equal(indexes[0].origin, "pk");
  } finally {
    connection.close();
  }
});

test("inserted official analysis payload is found with exact immutable provenance", () => {
  const { connection, repository } = createRepository();
  try {
    const record = createRecord();

    assert.deepEqual(repository.insertOrIgnore(record), { inserted: true });
    assert.deepEqual(repository.findByCacheIdentity(record.identity), {
      status: OfferAnalysisRepository.STATUS.FOUND,
      identity: record.identity,
      analysisPayload: record.analysisPayload,
      effectiveMaxOutputTokens: EFFECTIVE_MAX_OUTPUT_TOKENS,
      analyzedAt: ANALYZED_AT,
    });
  } finally {
    connection.close();
  }
});

test("unknown exact identity returns MISS", () => {
  const { connection, repository } = createRepository();
  try {
    assert.deepEqual(repository.findByCacheIdentity(createIdentity()), {
      status: OfferAnalysisRepository.STATUS.MISS,
    });
  } finally {
    connection.close();
  }
});

test("duplicate identity preserves the first payload and provenance", () => {
  const { connection, repository } = createRepository();
  try {
    const identity = createIdentity();
    const first = createRecord({ identity });
    const second = createRecord({
      identity,
      analysisPayload: createAnalysisPayload("Replace winner"),
      effectiveMaxOutputTokens: OTHER_EFFECTIVE_MAX_OUTPUT_TOKENS,
      analyzedAt: OTHER_ANALYZED_AT,
    });

    assert.deepEqual(repository.insertOrIgnore(first), { inserted: true });
    assert.deepEqual(repository.insertOrIgnore(second), { inserted: false });
    const found = repository.findByCacheIdentity(identity);
    assert.deepEqual(found.analysisPayload, first.analysisPayload);
    assert.equal(found.effectiveMaxOutputTokens, EFFECTIVE_MAX_OUTPUT_TOKENS);
    assert.equal(found.analyzedAt, ANALYZED_AT);
  } finally {
    connection.close();
  }
});

test("invalid JSON and mismatched identity columns are classified CORRUPT", () => {
  const { connection, repository } = createRepository();
  try {
    const invalidJsonIdentity = createIdentity();
    repository.insertOrIgnore(createRecord({ identity: invalidJsonIdentity }));
    connection.prepare(
      "UPDATE offer_analyses SET analysis_json = ? WHERE cache_key = ?",
    ).run("{invalid", invalidJsonIdentity.cacheKey);

    const mismatchedIdentity = createIdentity({ offerId: OTHER_OFFER_ID });
    repository.insertOrIgnore(createRecord({ identity: mismatchedIdentity }));
    connection.prepare(
      "UPDATE offer_analyses SET model = ? WHERE cache_key = ?",
    ).run("altered-model", mismatchedIdentity.cacheKey);

    assert.deepEqual(repository.findByCacheIdentity(invalidJsonIdentity), {
      status: OfferAnalysisRepository.STATUS.CORRUPT,
    });
    assert.deepEqual(repository.findByCacheIdentity(mismatchedIdentity), {
      status: OfferAnalysisRepository.STATUS.CORRUPT,
    });
  } finally {
    connection.close();
  }
});

test("targeted corrupt deletion leaves every other identity intact", () => {
  const { connection, repository } = createRepository();
  try {
    const targetedIdentity = createIdentity();
    const preservedIdentity = createIdentity({ offerId: OTHER_OFFER_ID });
    repository.insertOrIgnore(createRecord({ identity: targetedIdentity }));
    repository.insertOrIgnore(createRecord({ identity: preservedIdentity }));

    assert.deepEqual(repository.deleteCorruptByCacheIdentity(targetedIdentity), {
      deleted: true,
    });
    assert.equal(
      repository.findByCacheIdentity(targetedIdentity).status,
      OfferAnalysisRepository.STATUS.MISS,
    );
    assert.equal(
      repository.findByCacheIdentity(preservedIdentity).status,
      OfferAnalysisRepository.STATUS.FOUND,
    );
  } finally {
    connection.close();
  }
});

test("logical offer id persists without an offers table or foreign key", () => {
  const { connection, repository } = createRepository();
  try {
    const orphanIdentity = createIdentity({ offerId: OTHER_OFFER_ID });

    assert.deepEqual(repository.insertOrIgnore(createRecord({ identity: orphanIdentity })), {
      inserted: true,
    });
    assert.equal(
      repository.findByCacheIdentity(orphanIdentity).status,
      OfferAnalysisRepository.STATUS.FOUND,
    );
  } finally {
    connection.close();
  }
});

test("invalid record provenance is rejected before persistence", () => {
  const { connection, repository } = createRepository();
  try {
    const invalidRecords = [
      createRecord({ effectiveMaxOutputTokens: 0 }),
      createRecord({ effectiveMaxOutputTokens: CONFIGURED_MAX_OUTPUT_TOKENS + 1 }),
      createRecord({ analyzedAt: "invalid" }),
      createRecord({ analysisPayload: null }),
    ];

    for (const record of invalidRecords) {
      assert.throws(() => {
        return repository.insertOrIgnore(record);
      }, TypeError);
    }
  } finally {
    connection.close();
  }
});
