import test from "node:test";
import assert from "node:assert/strict";
import { CandidateDossierConstants } from "../../src/constants/CandidateDossierConstants.js";
import { CandidateDossier } from "../../src/models/CandidateDossier.js";
import { CandidateDossierRepositoryError } from "../../src/persistence/CandidateDossierRepositoryError.js";
import { CandidateDossierService } from "../../src/services/CandidateDossierService.js";
import { CandidateDossierServiceError } from "../../src/services/CandidateDossierServiceError.js";
import { CandidateDossierValidationError } from "../../src/services/CandidateDossierValidationError.js";
import { CandidateDossierValidator } from "../../src/services/CandidateDossierValidator.js";

const UPDATED_AT = "2026-08-13T10:20:30.000Z";
const AUTHORITATIVE_UPDATED_AT = "2026-08-13T10:20:31.000Z";

/**
 * Build one complete valid CandidateDossier value.
 * @returns {object} Complete generic dossier fixture.
 */
function createDossier() {
  return {
    schemaVersion: CandidateDossierConstants.SCHEMA_VERSION,
    experiences: [{
      id: "exp-1", role: "Generic role", organization: "Generic organization", client: null,
      startDate: "2024-01", endDate: null, current: true, domain: null,
      activities: [], achievements: [], technologies: [],
    }],
    projects: [],
    skills: [],
    education: [],
    languages: [],
    softSkills: [],
  };
}

/**
 * Create a tracked repository fake.
 * @param {object|null} found - Record returned by find.
 * @returns {object} Repository fake with call tracking.
 */
function createRepository(found = null) {
  return {
    findCalls: 0,
    saveCalls: [],
    find() {
      this.findCalls += 1;
      return found;
    },
    save(payload, updatedAt) {
      this.saveCalls.push({ payload, updatedAt });
      return { payload: structuredClone(payload), updatedAt };
    },
  };
}

/**
 * Create a tracked clock.
 * @param {string} value - Clock result.
 * @returns {Function} Tracked timestamp provider.
 */
function createClock(value = UPDATED_AT) {
  /**
   * Return the configured timestamp and record the invocation.
   * @returns {string} Configured clock value.
   */
  function clock() {
    clock.calls += 1;
    return value;
  }
  clock.calls = 0;
  return clock;
}

/**
 * Create the service with defaults suitable for orchestration tests.
 * @param {object} repository - Repository collaborator.
 * @param {object} [validator] - Validator collaborator.
 * @param {Function} [now] - Clock collaborator.
 * @returns {CandidateDossierService} Configured service.
 */
function createService(
  repository,
  validator = new CandidateDossierValidator(),
  now = createClock(),
) {
  return new CandidateDossierService({
    candidateDossierRepository: repository,
    candidateDossierValidator: validator,
    now,
  });
}

/**
 * Assert one safe CandidateDossier persistence service error.
 * @param {Function} action - Failing operation.
 * @returns {CandidateDossierServiceError} Captured service error.
 */
function expectPersistenceError(action) {
  let captured;
  assert.throws(action, (error) => {
    captured = error;
    assert.equal(error instanceof CandidateDossierServiceError, true);
    assert.equal(error.code, CandidateDossierServiceError.CODE.PERSISTENCE_ERROR);
    assert.equal(error.message, CandidateDossierServiceError.CODE.PERSISTENCE_ERROR);
    assert.deepEqual(error.safeDetails, {});
    assert.equal(JSON.stringify(error).includes("Generic"), false);
    return true;
  });
  return captured;
}

test("get returns the official empty dossier without validation clock or write", () => {
  const repository = createRepository();
  const now = createClock();
  const validator = {
    validate() {
      throw new Error("validator-must-not-run");
    },
  };
  const result = createService(repository, validator, now).get();

  assert.equal(result.dossier instanceof CandidateDossier, true);
  assert.deepEqual(result.dossier.toJson(), CandidateDossier.empty().toJson());
  assert.equal(result.updatedAt, null);
  assert.equal(repository.findCalls, 1);
  assert.equal(repository.saveCalls.length, 0);
  assert.equal(now.calls, 0);
});

test("get revalidates an existing repository payload into a domain object", () => {
  const payload = createDossier();
  const repository = createRepository({ payload, updatedAt: UPDATED_AT });
  const now = createClock();
  const realValidator = new CandidateDossierValidator();
  const validator = {
    calls: [],
    validate(value) {
      this.calls.push(value);
      return realValidator.validate(value);
    },
  };
  const result = createService(repository, validator, now).get();

  assert.equal(validator.calls.length, 1);
  assert.equal(validator.calls[0], payload);
  assert.equal(result.dossier instanceof CandidateDossier, true);
  assert.equal(result.updatedAt, UPDATED_AT);
  assert.equal(repository.saveCalls.length, 0);
  assert.equal(now.calls, 0);
});

test("get maps invalid persisted domain data to a safe service error", () => {
  const payload = { candidate: "Generic sensitive payload" };
  const repository = createRepository({ payload, updatedAt: UPDATED_AT });
  const error = expectPersistenceError(() => {
    createService(repository).get();
  });

  assert.equal(error.cause instanceof CandidateDossierValidationError, true);
  assert.equal(Object.hasOwn(error, "validationCode"), false);
  assert.equal(Object.hasOwn(error, "payload"), false);
});

test("get maps repository errors without exposing repository diagnostics", () => {
  const repository = createRepository();
  const cause = new Error("sensitive-sql-diagnostic");
  repository.find = () => {
    throw new CandidateDossierRepositoryError(
      CandidateDossierRepositoryError.CODE.PERSISTENCE_ERROR,
      cause,
    );
  };
  const error = expectPersistenceError(() => {
    createService(repository).get();
  });

  assert.equal(error.cause instanceof CandidateDossierRepositoryError, true);
  assert.equal(error.message.includes("sensitive"), false);
  assert.equal(Object.hasOwn(error, "payload"), false);
});

test("get propagates unexpected validator failures unchanged", () => {
  const unexpected = new Error("unexpected-validator-bug");
  const repository = createRepository({ payload: createDossier(), updatedAt: UPDATED_AT });
  const validator = {
    validate() {
      throw unexpected;
    },
  };

  assert.throws(() => {
    createService(repository, validator).get();
  }, (error) => {
    assert.equal(error, unexpected);
    return true;
  });
});

test("save propagates invalid user validation before clock or persistence", () => {
  const repository = createRepository();
  const now = createClock();
  const validationError = new CandidateDossierValidationError({
    validationCode: CandidateDossierValidationError.CODE.INVALID_STRUCTURE,
    message: "controlled-validation-message",
  });
  const validator = {
    validate() {
      throw validationError;
    },
  };

  assert.throws(() => {
    createService(repository, validator, now).save({ invalid: true });
  }, (error) => {
    assert.equal(error, validationError);
    return true;
  });
  assert.equal(now.calls, 0);
  assert.equal(repository.saveCalls.length, 0);
});

test("save validates before one clock call and returns the authoritative repository record", () => {
  const input = createDossier();
  const snapshot = structuredClone(input);
  const repository = createRepository();
  const realValidator = new CandidateDossierValidator();
  const validator = {
    calls: [],
    validate(value) {
      this.calls.push(value);
      return realValidator.validate(value);
    },
  };
  repository.save = function save(payload, updatedAt) {
    this.saveCalls.push({ payload, updatedAt });
    return { payload: structuredClone(payload), updatedAt: AUTHORITATIVE_UPDATED_AT };
  };
  const now = createClock();
  const result = createService(repository, validator, now).save(input);

  assert.equal(validator.calls.length, repository.saveCalls.length + 1);
  assert.equal(validator.calls[0], input);
  assert.notEqual(validator.calls[1], input);
  assert.deepEqual(validator.calls[1], snapshot);
  assert.equal(now.calls, 1);
  assert.equal(repository.saveCalls.length, 1);
  assert.deepEqual(repository.saveCalls[0], { payload: snapshot, updatedAt: UPDATED_AT });
  assert.equal(result.dossier instanceof CandidateDossier, true);
  assert.deepEqual(result.dossier.toJson(), snapshot);
  assert.equal(result.updatedAt, AUTHORITATIVE_UPDATED_AT);
  assert.deepEqual(input, snapshot);
});

test("save maps an invalid authoritative repository payload without a second write", () => {
  const repository = createRepository();
  repository.save = function save(payload, updatedAt) {
    this.saveCalls.push({ payload, updatedAt });
    return { payload: { candidate: "Generic corrupt result" }, updatedAt };
  };

  expectPersistenceError(() => {
    createService(repository).save(createDossier());
  });
  assert.equal(repository.saveCalls.length, 1);
});

test("save maps repository failures after validation and one clock call", () => {
  const repository = createRepository();
  repository.save = function save(payload, updatedAt) {
    this.saveCalls.push({ payload, updatedAt });
    throw new CandidateDossierRepositoryError(
      CandidateDossierRepositoryError.CODE.PERSISTENCE_ERROR,
      new Error("sensitive-sql-diagnostic"),
    );
  };
  const now = createClock();

  expectPersistenceError(() => {
    createService(repository, new CandidateDossierValidator(), now).save(createDossier());
  });
  assert.equal(now.calls, 1);
  assert.equal(repository.saveCalls.length, 1);
});

test("save maps a repository rejection of an invalid clock value", () => {
  const repository = createRepository();
  repository.save = function save(payload, updatedAt) {
    this.saveCalls.push({ payload, updatedAt });
    throw new CandidateDossierRepositoryError(
      CandidateDossierRepositoryError.CODE.INVALID_PERSISTED_METADATA,
    );
  };
  const now = createClock("invalid-timestamp");

  expectPersistenceError(() => {
    createService(repository, new CandidateDossierValidator(), now).save(createDossier());
  });
  assert.equal(now.calls, 1);
  assert.equal(repository.saveCalls.length, 1);
  assert.equal(repository.saveCalls[0].updatedAt, "invalid-timestamp");
});

test("service error accepts only its closed persistence taxonomy", () => {
  assert.deepEqual(Object.values(CandidateDossierServiceError.CODE), ["PERSISTENCE_ERROR"]);
  assert.throws(() => {
    new CandidateDossierServiceError("UNKNOWN");
  }, TypeError);
});
