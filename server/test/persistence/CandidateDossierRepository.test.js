import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { CandidateDossierRepository } from "../../src/persistence/CandidateDossierRepository.js";
import { CandidateDossierRepositoryError } from "../../src/persistence/CandidateDossierRepositoryError.js";

const UPDATED_AT = "2026-08-13T10:00:00.000Z";
const OTHER_UPDATED_AT = "2026-08-13T11:00:00.000Z";
const NON_SINGLETON_KEY = 2;

/**
 * Create one isolated in-memory repository and inspectable SQLite connection.
 * @returns {{connection: DatabaseSync, repository: CandidateDossierRepository}} Context.
 */
function createRepository() {
  const connection = new DatabaseSync(":memory:");
  const database = {
    getConnection() {
      return connection;
    },
  };
  return { connection, repository: new CandidateDossierRepository(database) };
}

/**
 * Build one generic complete CandidateDossier-shaped JSON payload.
 * @param {string} [value] - Generic skill value.
 * @returns {object} Plain JSON payload.
 */
function createPayload(value = "Generic Tool") {
  return {
    schemaVersion: "candidate-dossier-schema-v1",
    experiences: [],
    projects: [],
    skills: [{ id: "skill-1", category: "TOOL_OR_TECHNOLOGY", value, detail: null }],
    education: [],
    languages: [],
    softSkills: [],
  };
}

/**
 * Assert one operation fails with a safe repository code.
 * @param {Function} operation - Operation expected to fail.
 * @param {string} code - Expected safe code.
 * @returns {void}
 */
function expectCode(operation, code) {
  assert.throws(operation, (error) => {
    assert.equal(error instanceof CandidateDossierRepositoryError, true);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    return true;
  });
}

test("constructor creates the exact singleton table without foreign keys or extra indexes", () => {
  const { connection } = createRepository();
  try {
    const columns = connection.prepare("PRAGMA table_info(candidate_dossier)").all();
    const foreignKeys = connection.prepare("PRAGMA foreign_key_list(candidate_dossier)").all();
    const indexes = connection.prepare("PRAGMA index_list(candidate_dossier)").all();
    const table = connection.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'candidate_dossier'",
    ).get();

    assert.deepEqual(columns.map((column) => {
      return [column.name, column.type, column.notnull, column.pk];
    }), [
      ["singleton_key", "INTEGER", 0, 1],
      ["payload", "TEXT", 1, 0],
      ["updated_at", "TEXT", 1, 0],
    ]);
    assert.deepEqual(foreignKeys, []);
    assert.deepEqual(indexes, []);
    assert.match(table.sql, /CHECK \(singleton_key = 1\)/u);
  } finally {
    connection.close();
  }
});

test("absent find returns null without creating a row", () => {
  const { connection, repository } = createRepository();
  try {
    assert.equal(repository.find(), null);
    const count = connection.prepare("SELECT COUNT(*) AS count FROM candidate_dossier").get();
    assert.equal(count.count, 0);
  } finally {
    connection.close();
  }
});

test("first save returns and finds one exact detached JSON record", () => {
  const { connection, repository } = createRepository();
  try {
    const payload = createPayload("  Generic Tool  ");
    const saved = repository.save(payload, UPDATED_AT);
    payload.skills[0].value = "Caller mutation";
    saved.payload.skills[0].value = "Return mutation";

    assert.deepEqual(repository.find(), {
      payload: createPayload("  Generic Tool  "),
      updatedAt: UPDATED_AT,
    });
  } finally {
    connection.close();
  }
});

test("successive saves atomically replace the only singleton row", () => {
  const { connection, repository } = createRepository();
  try {
    repository.save(createPayload("First"), UPDATED_AT);
    const returned = repository.save(createPayload("Second"), OTHER_UPDATED_AT);
    const count = connection.prepare("SELECT COUNT(*) AS count FROM candidate_dossier").get();

    assert.equal(count.count, 1);
    assert.deepEqual(returned, {
      payload: createPayload("Second"),
      updatedAt: OTHER_UPDATED_AT,
    });
    assert.deepEqual(repository.find(), returned);
  } finally {
    connection.close();
  }
});

test("SQLite check constraint rejects every non-singleton key", () => {
  const { connection } = createRepository();
  try {
    assert.throws(() => {
      connection.prepare(
        "INSERT INTO candidate_dossier (singleton_key, payload, updated_at) VALUES (?, ?, ?)",
      ).run(NON_SINGLETON_KEY, "{}", UPDATED_AT);
    });
    assert.equal(
      connection.prepare("SELECT COUNT(*) AS count FROM candidate_dossier").get().count,
      0,
    );
  } finally {
    connection.close();
  }
});

test("invalid persisted JSON raises a safe error and preserves the row", () => {
  const { connection, repository } = createRepository();
  try {
    connection.prepare(
      "INSERT INTO candidate_dossier (singleton_key, payload, updated_at) VALUES (1, ?, ?)",
    ).run("{invalid", UPDATED_AT);
    expectCode(() => {
      repository.find();
    }, CandidateDossierRepositoryError.CODE.INVALID_PERSISTED_JSON);
    assert.equal(
      connection.prepare("SELECT COUNT(*) AS count FROM candidate_dossier").get().count,
      1,
    );
  } finally {
    connection.close();
  }
});

test("domain-invalid but readable JSON is returned without semantic validation", () => {
  const { connection, repository } = createRepository();
  try {
    const invalidDomain = { schemaVersion: "wrong-version", experiences: "not-an-array" };
    connection.prepare(
      "INSERT INTO candidate_dossier (singleton_key, payload, updated_at) VALUES (1, ?, ?)",
    ).run(JSON.stringify(invalidDomain), UPDATED_AT);

    assert.deepEqual(repository.find(), { payload: invalidDomain, updatedAt: UPDATED_AT });
  } finally {
    connection.close();
  }
});

test("invalid persisted or save timestamps fail safely without repair or writes", () => {
  const { connection, repository } = createRepository();
  try {
    connection.prepare(
      "INSERT INTO candidate_dossier (singleton_key, payload, updated_at) VALUES (1, ?, ?)",
    ).run("{}", "2026-08-13T10:00:00Z");
    expectCode(() => {
      repository.find();
    }, CandidateDossierRepositoryError.CODE.INVALID_PERSISTED_METADATA);
    connection.prepare("DELETE FROM candidate_dossier").run();

    expectCode(() => {
      repository.save(createPayload(), "invalid");
    }, CandidateDossierRepositoryError.CODE.INVALID_PERSISTED_METADATA);
    assert.equal(repository.find(), null);
  } finally {
    connection.close();
  }
});

test("non-serializable payload and SQLite failures use the generic safe code", () => {
  const { connection, repository } = createRepository();
  try {
    const cyclic = {};
    cyclic.self = cyclic;
    expectCode(() => {
      repository.save(cyclic, UPDATED_AT);
    }, CandidateDossierRepositoryError.CODE.PERSISTENCE_ERROR);
    assert.equal(repository.find(), null);

    connection.exec("DROP TABLE candidate_dossier");
    expectCode(() => {
      repository.find();
    }, CandidateDossierRepositoryError.CODE.PERSISTENCE_ERROR);
  } finally {
    connection.close();
  }
});

test("candidate dossier persistence leaves historical profiles untouched", () => {
  const connection = new DatabaseSync(":memory:");
  try {
    connection.exec("CREATE TABLE profiles (id INTEGER PRIMARY KEY, label TEXT NOT NULL)");
    connection.prepare("INSERT INTO profiles (id, label) VALUES (?, ?)").run(1, "Saved search");
    const database = {
      getConnection() {
        return connection;
      },
    };
    const repository = new CandidateDossierRepository(database);
    repository.save(createPayload(), UPDATED_AT);

    const rows = connection.prepare("SELECT * FROM profiles").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 1);
    assert.equal(rows[0].label, "Saved search");
  } finally {
    connection.close();
  }
});

test("repository error exposes only its exact closed safe taxonomy", () => {
  assert.deepEqual(Object.values(CandidateDossierRepositoryError.CODE), [
    "PERSISTENCE_ERROR",
    "INVALID_PERSISTED_JSON",
    "INVALID_PERSISTED_METADATA",
  ]);
  assert.throws(() => {
    new CandidateDossierRepositoryError("UNKNOWN");
  }, TypeError);
});
