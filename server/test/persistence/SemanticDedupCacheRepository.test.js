import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SemanticDedupCacheRepository } from "../../src/persistence/SemanticDedupCacheRepository.js";

/**
 * Wrap one in-memory native SQLite connection like the production Database.
 * @returns {object} Database wrapper and connection.
 */
function createDatabase() {
  const connection = new DatabaseSync(":memory:");
  return {
    connection,
    database: {
      getConnection() {
        return connection;
      },
    },
  };
}

test("semantic cache persists the first decision across repository instances", () => {
  const { connection, database } = createDatabase();
  try {
    const firstRepository = new SemanticDedupCacheRepository(database);
    firstRepository.insertOrIgnore("key", "version", {
      inputCount: 2,
      components: [[0, 1]],
    });
    firstRepository.insertOrIgnore("key", "version", {
      inputCount: 2,
      components: [],
    });
    const secondRepository = new SemanticDedupCacheRepository(database);

    assert.deepEqual(secondRepository.find("key"), {
      inputCount: 2,
      components: [[0, 1]],
    });
  } finally {
    connection.close();
  }
});

test("semantic cache ignores missing and corrupt decisions", () => {
  const { connection, database } = createDatabase();
  try {
    const repository = new SemanticDedupCacheRepository(database);
    connection.prepare(`
      INSERT INTO semantic_dedup_cache
        (cache_key, policy_version, decision_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run("corrupt", "version", "{invalid", new Date().toISOString());

    assert.equal(repository.find("missing"), null);
    assert.equal(repository.find("corrupt"), null);
  } finally {
    connection.close();
  }
});
