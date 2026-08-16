import test from "node:test";
import assert from "node:assert/strict";
import { HttpStatus } from "../../src/constants/HttpStatus.js";
import { OfferPreparationConstants } from "../../src/constants/OfferPreparationConstants.js";
import { OfferAnalysis } from "../../src/models/OfferAnalysis.js";
import { OfferAnalysisRepository } from "../../src/persistence/OfferAnalysisRepository.js";
import { OfferAnalysisService } from "../../src/services/OfferAnalysisService.js";
import { OfferAnalysisServiceError } from "../../src/services/OfferAnalysisServiceError.js";
import { OfferAnalysisValidationError } from "../../src/services/OfferAnalysisValidationError.js";
import { OfferAnalyzerError } from "../../src/services/OfferAnalyzerError.js";
import { OfferPreparationError } from "../../src/services/OfferPreparationError.js";

const REQUESTED_ID = 7;
const AUTHORITATIVE_ID = 17;
const EFFECTIVE_TEXT = "  Texte exact sans normalisation.  ";
const LOCAL_ANALYZED_AT = "2026-08-13T10:00:00.000Z";
const WINNER_ANALYZED_AT = "2026-08-13T09:00:00.000Z";
const CONFIGURED_MAX_OUTPUT_TOKENS = 4096;
const FRESH_EFFECTIVE_MAX_OUTPUT_TOKENS = 3584;
const CACHED_EFFECTIVE_MAX_OUTPUT_TOKENS = 3072;
const WINNER_EFFECTIVE_MAX_OUTPUT_TOKENS = 2048;
const EXPECTED_REREAD_COUNT = 2;
const EXPECTED_OWNER_READ_COUNT = 3;
const EXPECTED_REPAIR_INSERT_COUNT = 2;
const EXPECTED_REPAIR_READ_COUNT = 4;

/**
 * Build one detached analysis payload with an observable activity value.
 * @param {string} [value] - Activity value.
 * @returns {object} Analysis JSON payload.
 */
function createPayload(value = "Analyse A") {
  return {
    seniority: null,
    activities: [{ value, assertion: "EXPLICIT", evidence: { text: value } }],
    requirements: [],
    context: [],
    workConditions: { workMode: null, constraints: [] },
  };
}

/**
 * Build the exact deterministic projected input used by the runtime tests.
 * @returns {object} Projected input.
 */
function createProjectedInput() {
  return {
    effectiveText: EFFECTIVE_TEXT,
    offerSnapshot: { offerId: AUTHORITATIVE_ID },
    effectiveContentOrigin: "USER",
    contentFingerprint: "content-fingerprint",
    deterministicInputFingerprint: "input-fingerprint",
  };
}

/**
 * Build one immutable cache identity.
 * @returns {Readonly<object>} Cache identity.
 */
function createIdentity() {
  return Object.freeze({
    cacheKey: "cache-key",
    offerId: AUTHORITATIVE_ID,
    contentFingerprint: "content-fingerprint",
    deterministicInputFingerprint: "input-fingerprint",
    policyVersion: "offer-analyzer-v5",
    schemaVersion: "offer-analysis-schema-v1",
    llmProvider: "GROQ",
    model: "model-a",
    configuredMaxOutputTokens: CONFIGURED_MAX_OUTPUT_TOKENS,
  });
}

/**
 * Build one repository FOUND result.
 * @param {object} [overrides] - Persisted winner overrides.
 * @returns {object} Repository result.
 */
function createFound({
  identity = createIdentity(),
  payload = createPayload("Winner"),
  effectiveMaxOutputTokens = CACHED_EFFECTIVE_MAX_OUTPUT_TOKENS,
  analyzedAt = WINNER_ANALYZED_AT,
} = {}) {
  return {
    status: OfferAnalysisRepository.STATUS.FOUND,
    identity,
    analysisPayload: payload,
    effectiveMaxOutputTokens,
    analyzedAt,
  };
}

/**
 * Create a manually controlled Promise for deterministic concurrency tests.
 * @returns {object} Promise and resolve/reject controls.
 */
function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/**
 * Build an observable sequential runtime harness.
 * @param {object} [overrides] - Dependency behavior overrides.
 * @returns {object} Service, collaborators and call observations.
 */
function createHarness(overrides = {}) {
  const calls = {
    prepare: 0,
    projector: 0,
    metadata: 0,
    identity: 0,
    find: 0,
    delete: 0,
    analyzer: 0,
    validator: 0,
    now: 0,
    insert: 0,
    events: [],
  };
  const offer = { id: AUTHORITATIVE_ID };
  const projectedInput = createProjectedInput();
  const identity = createIdentity();
  const executionMetadata = {
    policyVersion: identity.policyVersion,
    schemaVersion: identity.schemaVersion,
    provider: identity.llmProvider,
    model: identity.model,
    configuredMaxOutputTokens: identity.configuredMaxOutputTokens,
  };
  const localAnalysis = new OfferAnalysis(createPayload("Local"));
  let persisted = null;
  const queuedFinds = [...(overrides.findResults ?? [])];
  const repository = {
    findByCacheIdentity(receivedIdentity) {
      calls.find += 1;
      calls.events.push(`find:${calls.find}`);
      if (overrides.identities) {
        assert.ok(overrides.identities.includes(receivedIdentity));
      } else {
        assert.equal(receivedIdentity, identity);
      }
      if (overrides.findErrorAt === calls.find) {
        throw new Error("SQL details must remain internal");
      }
      if (queuedFinds.length) {
        return queuedFinds.shift();
      }
      return persisted ?? { status: OfferAnalysisRepository.STATUS.MISS };
    },
    deleteCorruptByCacheIdentity(receivedIdentity) {
      calls.delete += 1;
      calls.events.push("delete");
      assert.equal(receivedIdentity, identity);
      if (overrides.deleteError) {
        throw new Error("delete failed");
      }
      persisted = null;
      return { deleted: overrides.deleted ?? true };
    },
    insertOrIgnore(record) {
      calls.insert += 1;
      calls.events.push("insert");
      if (overrides.insertError) {
        throw new Error("insert failed");
      }
      if (overrides.insertImplementation) {
        return overrides.insertImplementation(record, (value) => {
          persisted = value;
        });
      }
      if (overrides.onInsert) {
        persisted = overrides.onInsert(record);
      } else {
        persisted = createFound({
          identity: record.identity,
          payload: record.analysisPayload,
          effectiveMaxOutputTokens: record.effectiveMaxOutputTokens,
          analyzedAt: record.analyzedAt,
        });
      }
      return { inserted: overrides.inserted ?? true };
    },
  };
  const preparationError = overrides.preparationError;
  const analyzerError = overrides.analyzerError;
  const service = new OfferAnalysisService({
    offerPreparationService: {
      prepare(id) {
        calls.prepare += 1;
        calls.events.push("prepare");
        assert.equal(id, REQUESTED_ID);
        if (preparationError) {
          throw preparationError;
        }
        return {
          prepareStatus: overrides.prepareStatus
            ?? OfferPreparationConstants.STATUS.READY,
          offer,
        };
      },
    },
    inputProjector: {
      build(receivedOffer) {
        calls.projector += 1;
        calls.events.push("project");
        assert.equal(receivedOffer, offer);
        return projectedInput;
      },
    },
    cacheIdentityBuilder: {
      build(components) {
        calls.identity += 1;
        calls.events.push("identity");
        assert.deepEqual(components, {
          offerId: AUTHORITATIVE_ID,
          contentFingerprint: projectedInput.contentFingerprint,
          deterministicInputFingerprint: projectedInput.deterministicInputFingerprint,
          policyVersion: executionMetadata.policyVersion,
          schemaVersion: executionMetadata.schemaVersion,
          llmProvider: executionMetadata.provider,
          model: executionMetadata.model,
          configuredMaxOutputTokens: executionMetadata.configuredMaxOutputTokens,
        });
        return overrides.identities?.[calls.identity - 1] ?? identity;
      },
    },
    offerAnalysisRepository: repository,
    offerAnalyzerService: {
      getExecutionMetadata() {
        calls.metadata += 1;
        calls.events.push("metadata");
        return executionMetadata;
      },
      async analyzeProjectedInput(receivedInput) {
        calls.analyzer += 1;
        calls.events.push("analyzer");
        assert.equal(receivedInput, projectedInput);
        if (analyzerError) {
          throw analyzerError;
        }
        if (overrides.analyzerImplementation) {
          return await overrides.analyzerImplementation(receivedInput, localAnalysis);
        }
        return {
          offerAnalysis: localAnalysis,
          analyzer: {
            maxOutputTokens: overrides.effectiveMaxOutputTokens
              ?? FRESH_EFFECTIVE_MAX_OUTPUT_TOKENS,
          },
        };
      },
    },
    analysisValidator: {
      validate(payload, effectiveText) {
        calls.validator += 1;
        calls.events.push(`validator:${calls.validator}`);
        assert.equal(effectiveText, EFFECTIVE_TEXT);
        if (overrides.validator) {
          return overrides.validator(payload, calls.validator);
        }
        return new OfferAnalysis(payload);
      },
    },
    now() {
      calls.now += 1;
      calls.events.push("now");
      return LOCAL_ANALYZED_AT;
    },
  });
  return { service, calls, identity, localAnalysis, projectedInput };
}

/**
 * Capture one expected OfferAnalysisServiceError.
 * @param {Promise<unknown>} promise - Rejected runtime call.
 * @param {string} code - Expected closed error code.
 * @returns {Promise<OfferAnalysisServiceError>} Captured error.
 */
async function captureServiceError(promise, code) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof OfferAnalysisServiceError);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail("Expected OfferAnalysisService to fail");
}

test("valid cache hit returns the revalidated domain winner without Analyzer or clock", async () => {
  const found = createFound();
  const harness = createHarness({ findResults: [found] });
  const result = await harness.service.analyze(REQUESTED_ID);

  assert.ok(result.analysis instanceof OfferAnalysis);
  assert.equal(result.analysis.activities[0].value, "Winner");
  assert.equal(result.cacheHit, true);
  assert.equal(result.identity, found.identity);
  assert.equal(result.identity.cacheKey, found.identity.cacheKey);
  assert.equal(result.identity.offerId, found.identity.offerId);
  assert.equal(result.identity.schemaVersion, found.identity.schemaVersion);
  assert.equal(result.identity.policyVersion, found.identity.policyVersion);
  assert.equal(result.offerSnapshot, harness.projectedInput.offerSnapshot);
  assert.deepEqual(result.analyzer, {
    policyVersion: found.identity.policyVersion,
    schemaVersion: found.identity.schemaVersion,
    provider: found.identity.llmProvider,
    model: found.identity.model,
    configuredMaxOutputTokens: found.identity.configuredMaxOutputTokens,
    effectiveMaxOutputTokens: found.effectiveMaxOutputTokens,
  });
  assert.equal(result.analyzedAt, found.analyzedAt);
  assert.equal(harness.calls.analyzer, 0);
  assert.equal(harness.calls.now, 0);
  assert.equal(harness.calls.insert, 0);
  assert.equal(harness.calls.validator, 1);
});

test("cache miss analyzes once, timestamps, inserts and returns the revalidated DB row", async () => {
  const harness = createHarness();
  const result = await harness.service.analyze(REQUESTED_ID);

  assert.equal(result.cacheHit, false);
  assert.equal(result.identity, harness.identity);
  assert.equal(result.identity.cacheKey, harness.identity.cacheKey);
  assert.equal(result.identity.offerId, harness.identity.offerId);
  assert.equal(result.identity.schemaVersion, harness.identity.schemaVersion);
  assert.equal(result.identity.policyVersion, harness.identity.policyVersion);
  assert.equal(result.offerSnapshot, harness.projectedInput.offerSnapshot);
  assert.ok(result.analysis instanceof OfferAnalysis);
  assert.equal(result.analysis.activities[0].value, "Local");
  assert.equal(result.analyzedAt, LOCAL_ANALYZED_AT);
  assert.equal(
    result.analyzer.effectiveMaxOutputTokens,
    FRESH_EFFECTIVE_MAX_OUTPUT_TOKENS,
  );
  assert.deepEqual(harness.calls.events, [
    "prepare", "project", "metadata", "identity", "find:1", "find:2",
    "analyzer", "now", "insert", "find:3", "validator:1",
  ]);
  assert.equal(harness.calls.prepare, 1);
  assert.equal(harness.calls.projector, 1);
  assert.equal(harness.calls.analyzer, 1);
  assert.equal(harness.calls.now, 1);
  assert.equal(harness.calls.insert, 1);
});

test("a second sequential call reuses the first persisted analysis", async () => {
  const harness = createHarness();
  const first = await harness.service.analyze(REQUESTED_ID);
  const second = await harness.service.analyze(REQUESTED_ID);
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(harness.calls.analyzer, 1);
  assert.equal(harness.calls.insert, 1);
  assert.equal(harness.calls.now, 1);
});

test("initial repository corruption is deleted before recomputation", async () => {
  const harness = createHarness({
    findResults: [{ status: OfferAnalysisRepository.STATUS.CORRUPT }],
  });
  await harness.service.analyze(REQUESTED_ID);
  assert.equal(harness.calls.delete, 1);
  assert.equal(harness.calls.analyzer, 1);
  assert.ok(harness.calls.events.indexOf("delete") < harness.calls.events.indexOf("analyzer"));
});

test("semantically invalid cache is deleted but unexpected validator errors propagate", async () => {
  const validationError = new OfferAnalysisValidationError({
    validationCode: OfferAnalysisValidationError.CODE.STRUCTURE,
    message: "invalid persisted payload",
  });
  const invalid = createHarness({
    findResults: [createFound()],
    validator(payload, call) {
      if (call === 1) {
        throw validationError;
      }
      return new OfferAnalysis(payload);
    },
  });
  const result = await invalid.service.analyze(REQUESTED_ID);
  assert.equal(result.cacheHit, false);
  assert.equal(invalid.calls.delete, 1);
  assert.equal(invalid.calls.analyzer, 1);

  const unexpected = new Error("validator bug");
  const broken = createHarness({
    findResults: [createFound()],
    validator() {
      throw unexpected;
    },
  });
  await assert.rejects(broken.service.analyze(REQUESTED_ID), (error) => {
    return error === unexpected;
  });
  assert.equal(broken.calls.delete, 0);
  assert.equal(broken.calls.analyzer, 0);
});

test("both non-READY statuses stop before projection, cache, Analyzer and clock", async () => {
  for (const prepareStatus of [
    OfferPreparationConstants.STATUS.NEEDS_PROVIDER_ACQUISITION,
    OfferPreparationConstants.STATUS.NEEDS_USER_TEXT,
  ]) {
    const harness = createHarness({ prepareStatus });
    const error = await captureServiceError(
      harness.service.analyze(REQUESTED_ID),
      OfferAnalysisServiceError.CODE.OFFER_NOT_READY,
    );
    assert.deepEqual(error.safeDetails, { prepareStatus });
    assert.equal(harness.calls.projector, 0);
    assert.equal(harness.calls.find, 0);
    assert.equal(harness.calls.analyzer, 0);
    assert.equal(harness.calls.now, 0);
  }
});

test("preparation errors remain unchanged", async () => {
  for (const original of [
    new OfferPreparationError("Invalid offer id", HttpStatus.BAD_REQUEST),
    new OfferPreparationError("Offer not found", HttpStatus.NOT_FOUND),
  ]) {
    const harness = createHarness({ preparationError: original });
    await assert.rejects(harness.service.analyze(REQUESTED_ID), (error) => {
      return error === original;
    });
    assert.equal(harness.calls.projector, 0);
    assert.equal(harness.calls.find, 0);
  }
});

test("Analyzer errors remain unchanged and never timestamp or persist", async () => {
  const original = new OfferAnalyzerError(OfferAnalyzerError.CODE.ANALYZER_TIMEOUT);
  const harness = createHarness({ analyzerError: original });
  await assert.rejects(harness.service.analyze(REQUESTED_ID), (error) => {
    return error === original;
  });
  assert.equal(harness.calls.now, 0);
  assert.equal(harness.calls.insert, 0);
  assert.equal(harness.calls.find, EXPECTED_REREAD_COUNT);
});

test("repository read, delete, insert and reread failures map to safe persistence errors", async () => {
  const cases = [
    createHarness({ findErrorAt: 1 }),
    createHarness({
      findResults: [{ status: OfferAnalysisRepository.STATUS.CORRUPT }],
      deleteError: true,
    }),
    createHarness({ insertError: true }),
    createHarness({ findErrorAt: 2 }),
  ];
  for (const [index, harness] of cases.entries()) {
    const error = await captureServiceError(
      harness.service.analyze(REQUESTED_ID),
      OfferAnalysisServiceError.CODE.CACHE_PERSISTENCE_ERROR,
    );
    assert.deepEqual(error.safeDetails, {});
    assert.equal(error.message.includes("SQL"), false);
    if (index < EXPECTED_REREAD_COUNT) {
      assert.equal(harness.calls.analyzer, 0);
    }
  }
});

test("authoritative DB winner replaces every local post-analysis value", async () => {
  const winner = createFound({
    payload: createPayload("Concurrent winner"),
    effectiveMaxOutputTokens: WINNER_EFFECTIVE_MAX_OUTPUT_TOKENS,
    analyzedAt: WINNER_ANALYZED_AT,
  });
  const harness = createHarness({
    onInsert: () => {
      return winner;
    },
    inserted: false,
  });
  const result = await harness.service.analyze(REQUESTED_ID);
  assert.equal(result.cacheHit, false);
  assert.equal(result.analysis.activities[0].value, "Concurrent winner");
  assert.equal(result.identity, winner.identity);
  assert.equal(result.offerSnapshot, harness.projectedInput.offerSnapshot);
  assert.equal(result.analyzedAt, WINNER_ANALYZED_AT);
  assert.equal(
    result.analyzer.effectiveMaxOutputTokens,
    WINNER_EFFECTIVE_MAX_OUTPUT_TOKENS,
  );
  assert.notEqual(result.analysis, harness.localAnalysis);
});

test("invalid post-insert winners receive one bounded repair", async () => {
  const validationError = new OfferAnalysisValidationError({
    validationCode: OfferAnalysisValidationError.CODE.STRUCTURE,
    message: "invalid winner",
  });
  const cases = [
    createHarness({ findResults: [
      { status: OfferAnalysisRepository.STATUS.MISS },
      { status: OfferAnalysisRepository.STATUS.MISS },
      { status: OfferAnalysisRepository.STATUS.MISS },
      createFound(),
    ] }),
    createHarness({ findResults: [
      { status: OfferAnalysisRepository.STATUS.MISS },
      { status: OfferAnalysisRepository.STATUS.MISS },
      { status: OfferAnalysisRepository.STATUS.CORRUPT },
      createFound(),
    ] }),
    createHarness({
      findResults: [
        { status: OfferAnalysisRepository.STATUS.MISS },
        { status: OfferAnalysisRepository.STATUS.MISS },
        createFound(),
        createFound(),
      ],
      validator(payload, call) {
        if (call === 1) {
          throw validationError;
        }
        return new OfferAnalysis(payload);
      },
    }),
  ];
  for (const harness of cases) {
    const result = await harness.service.analyze(REQUESTED_ID);
    assert.equal(result.cacheHit, false);
    assert.equal(harness.calls.analyzer, 1);
    assert.equal(harness.calls.insert, EXPECTED_REPAIR_INSERT_COUNT);
    assert.equal(harness.calls.now, 1);
    assert.equal(harness.calls.find, EXPECTED_REPAIR_READ_COUNT);
  }
});

test("same-key owner and waiter share one Analyzer generation and false cacheHit", async () => {
  const analyzerStarted = createDeferred();
  const releaseAnalyzer = createDeferred();
  const harness = createHarness({
    analyzerImplementation: async (input, localAnalysis) => {
      analyzerStarted.resolve();
      await releaseAnalyzer.promise;
      return {
        offerAnalysis: localAnalysis,
        analyzer: { maxOutputTokens: FRESH_EFFECTIVE_MAX_OUTPUT_TOKENS },
      };
    },
  });

  const owner = harness.service.analyze(REQUESTED_ID);
  const waiter = harness.service.analyze(REQUESTED_ID);
  await analyzerStarted.promise;
  assert.equal(harness.calls.analyzer, 1);
  releaseAnalyzer.resolve();
  const [ownerResult, waiterResult] = await Promise.all([owner, waiter]);

  assert.equal(ownerResult, waiterResult);
  assert.equal(ownerResult.identity, harness.identity);
  assert.equal(ownerResult.offerSnapshot, harness.projectedInput.offerSnapshot);
  assert.equal(ownerResult.cacheHit, false);
  assert.equal(harness.calls.analyzer, 1);
  assert.equal(harness.calls.prepare, EXPECTED_REREAD_COUNT);
  assert.equal(harness.calls.projector, EXPECTED_REREAD_COUNT);
  assert.equal(harness.service.inFlight.size, 0);
});

test("owner double-check hit is shared as a cache hit without generation", async () => {
  const harness = createHarness({
    findResults: [
      { status: OfferAnalysisRepository.STATUS.MISS },
      { status: OfferAnalysisRepository.STATUS.MISS },
      createFound(),
    ],
  });
  const [owner, waiter] = await Promise.all([
    harness.service.analyze(REQUESTED_ID),
    harness.service.analyze(REQUESTED_ID),
  ]);
  assert.equal(owner, waiter);
  assert.deepEqual(owner.identity, harness.identity);
  assert.equal(owner.offerSnapshot, harness.projectedInput.offerSnapshot);
  assert.equal(owner.cacheHit, true);
  assert.equal(harness.calls.find, EXPECTED_OWNER_READ_COUNT);
  assert.equal(harness.calls.analyzer, 0);
  assert.equal(harness.calls.now, 0);
  assert.equal(harness.calls.insert, 0);
  assert.equal(harness.service.inFlight.size, 0);
});

test("same offer id with different cache keys starts independent generations", async () => {
  const identityA = createIdentity();
  const identityB = Object.freeze({ ...identityA, cacheKey: "cache-key-b" });
  const bothStarted = createDeferred();
  const release = createDeferred();
  const expected = new Error("stop after concurrency observation");
  let started = 0;
  const harness = createHarness({
    identities: [identityA, identityB],
    analyzerImplementation: async () => {
      started += 1;
      if (started === EXPECTED_REREAD_COUNT) {
        bothStarted.resolve();
      }
      await release.promise;
      throw expected;
    },
  });
  const first = harness.service.analyze(REQUESTED_ID);
  const second = harness.service.analyze(REQUESTED_ID);
  await bothStarted.promise;
  assert.equal(harness.calls.analyzer, EXPECTED_REREAD_COUNT);
  assert.equal(harness.service.inFlight.size, EXPECTED_REREAD_COUNT);
  release.resolve();
  const results = await Promise.allSettled([first, second]);
  assert.equal(results[0].reason, expected);
  assert.equal(results[1].reason, expected);
  assert.equal(harness.service.inFlight.size, 0);
});

test("shared Analyzer failure cleans inFlight and allows a later retry", async () => {
  const analyzerStarted = createDeferred();
  const releaseFailure = createDeferred();
  const original = new OfferAnalyzerError(OfferAnalyzerError.CODE.ANALYZER_TIMEOUT);
  let fail = true;
  const harness = createHarness({
    analyzerImplementation: async (input, localAnalysis) => {
      if (fail) {
        analyzerStarted.resolve();
        await releaseFailure.promise;
        throw original;
      }
      return {
        offerAnalysis: localAnalysis,
        analyzer: { maxOutputTokens: FRESH_EFFECTIVE_MAX_OUTPUT_TOKENS },
      };
    },
  });
  const owner = harness.service.analyze(REQUESTED_ID);
  const waiter = harness.service.analyze(REQUESTED_ID);
  await analyzerStarted.promise;
  releaseFailure.resolve();
  const failures = await Promise.allSettled([owner, waiter]);
  assert.equal(failures[0].reason, original);
  assert.equal(failures[1].reason, original);
  assert.equal(harness.calls.analyzer, 1);
  assert.equal(harness.service.inFlight.size, 0);

  fail = false;
  const retried = await harness.service.analyze(REQUESTED_ID);
  assert.equal(retried.cacheHit, false);
  assert.equal(harness.calls.analyzer, EXPECTED_REREAD_COUNT);
});

test("shared persistence failure cleans inFlight and allows a later retry", async () => {
  let failInsert = true;
  const harness = createHarness({
    insertImplementation(record, setPersisted) {
      if (failInsert) {
        throw new Error("insert unavailable");
      }
      setPersisted(createFound({
        identity: record.identity,
        payload: record.analysisPayload,
        effectiveMaxOutputTokens: record.effectiveMaxOutputTokens,
        analyzedAt: record.analyzedAt,
      }));
      return { inserted: true };
    },
  });
  const results = await Promise.allSettled([
    harness.service.analyze(REQUESTED_ID),
    harness.service.analyze(REQUESTED_ID),
  ]);
  for (const result of results) {
    assert.ok(result.reason instanceof OfferAnalysisServiceError);
    assert.equal(
      result.reason.code,
      OfferAnalysisServiceError.CODE.CACHE_PERSISTENCE_ERROR,
    );
  }
  assert.equal(harness.calls.analyzer, 1);
  assert.equal(harness.service.inFlight.size, 0);

  failInsert = false;
  await harness.service.analyze(REQUESTED_ID);
  assert.equal(harness.calls.analyzer, EXPECTED_REREAD_COUNT);
});

test("repair reuses one local record and returns a concurrent final winner", async () => {
  const concurrent = createFound({
    payload: createPayload("Repair winner B"),
    effectiveMaxOutputTokens: WINNER_EFFECTIVE_MAX_OUTPUT_TOKENS,
    analyzedAt: WINNER_ANALYZED_AT,
  });
  const insertedRecords = [];
  const harness = createHarness({
    findResults: [
      { status: OfferAnalysisRepository.STATUS.MISS },
      { status: OfferAnalysisRepository.STATUS.MISS },
      { status: OfferAnalysisRepository.STATUS.CORRUPT },
      concurrent,
    ],
    insertImplementation(record) {
      insertedRecords.push(record);
      return { inserted: insertedRecords.length === 1 };
    },
  });
  const result = await harness.service.analyze(REQUESTED_ID);
  assert.equal(insertedRecords.length, EXPECTED_REPAIR_INSERT_COUNT);
  assert.equal(insertedRecords[0], insertedRecords[1]);
  assert.equal(harness.calls.delete, 1);
  assert.equal(harness.calls.analyzer, 1);
  assert.equal(harness.calls.now, 1);
  assert.equal(result.cacheHit, false);
  assert.equal(result.analysis.activities[0].value, "Repair winner B");
  assert.equal(result.analyzedAt, WINNER_ANALYZED_AT);
});

test("repair exhaustion stops after two inserts without another Analyzer or clock", async () => {
  for (const finalResult of [
    { status: OfferAnalysisRepository.STATUS.MISS },
    { status: OfferAnalysisRepository.STATUS.CORRUPT },
  ]) {
    const harness = createHarness({
      findResults: [
        { status: OfferAnalysisRepository.STATUS.MISS },
        { status: OfferAnalysisRepository.STATUS.MISS },
        { status: OfferAnalysisRepository.STATUS.MISS },
        finalResult,
      ],
    });
    await captureServiceError(
      harness.service.analyze(REQUESTED_ID),
      OfferAnalysisServiceError.CODE.CACHE_PERSISTENCE_ERROR,
    );
    assert.equal(harness.calls.insert, EXPECTED_REPAIR_INSERT_COUNT);
    assert.equal(harness.calls.analyzer, 1);
    assert.equal(harness.calls.now, 1);
    assert.equal(harness.service.inFlight.size, 0);
  }
});

test("delete failure during winner repair stops before repair insertion", async () => {
  const harness = createHarness({
    findResults: [
      { status: OfferAnalysisRepository.STATUS.MISS },
      { status: OfferAnalysisRepository.STATUS.MISS },
      { status: OfferAnalysisRepository.STATUS.CORRUPT },
    ],
    deleteError: true,
  });
  await captureServiceError(
    harness.service.analyze(REQUESTED_ID),
    OfferAnalysisServiceError.CODE.CACHE_PERSISTENCE_ERROR,
  );
  assert.equal(harness.calls.insert, 1);
  assert.equal(harness.calls.analyzer, 1);
  assert.equal(harness.calls.now, 1);
});

test("unexpected validator errors propagate from post-insert and post-repair reads", async () => {
  const unexpected = new Error("validator implementation bug");
  for (const findResults of [
    [
      { status: OfferAnalysisRepository.STATUS.MISS },
      { status: OfferAnalysisRepository.STATUS.MISS },
      createFound(),
    ],
    [
      { status: OfferAnalysisRepository.STATUS.MISS },
      { status: OfferAnalysisRepository.STATUS.MISS },
      { status: OfferAnalysisRepository.STATUS.MISS },
      createFound(),
    ],
  ]) {
    const harness = createHarness({
      findResults,
      validator() {
        throw unexpected;
      },
    });
    await assert.rejects(harness.service.analyze(REQUESTED_ID), (error) => {
      return error === unexpected;
    });
    assert.equal(harness.service.inFlight.size, 0);
  }
});

test("service error exposes only its closed runtime taxonomy", () => {
  assert.deepEqual(OfferAnalysisServiceError.CODE, {
    OFFER_NOT_READY: "OFFER_NOT_READY",
    CACHE_PERSISTENCE_ERROR: "CACHE_PERSISTENCE_ERROR",
  });
  assert.equal(Object.isFrozen(OfferAnalysisServiceError.CODE), true);
});
