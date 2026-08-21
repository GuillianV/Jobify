import test from "node:test";
import assert from "node:assert/strict";
import { CoverLetterConstants } from "../../src/constants/CoverLetterConstants.js";
import {
  CoverLetterOrchestrator,
  createCoverLetterState,
} from "../../src/services/CoverLetterOrchestrator.js";

const OFFER_A_ID = 42;
const OFFER_B_ID = 84;

/**
 * Create one externally resolvable promise.
 * @returns {object} Promise controls.
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
 * Build one atomic ApplicationBrief result fixture.
 * @param {string} token - Opaque generation token.
 * @returns {object} Result fixture.
 */
function createBriefResult(token = "token-a") {
  return { brief: { schemaVersion: "application-brief-schema-v1" }, generationToken: token };
}

/**
 * Build one CoverLetter fixture.
 * @param {string} letter - Generated text.
 * @returns {object} CoverLetter fixture.
 */
function createCoverLetter(letter = "Letter A") {
  return {
    schemaVersion: "cover-letter-schema-v1",
    letter,
    usedClaimIndexes: [0],
  };
}

/**
 * Build one observable CoverLetter orchestrator harness.
 * @param {Function} request - Injected generation operation.
 * @returns {object} Harness.
 */
function createHarness(request) {
  const state = {
    selectedOfferId: OFFER_A_ID,
    applicationBriefResult: createBriefResult(),
    visible: createCoverLetterState(),
    updateCount: 0,
    refreshCount: 0,
  };
  const calls = [];
  const orchestrator = new CoverLetterOrchestrator({
    async generateCoverLetter(offerId, applicationBriefResult, requestImplementation, signal) {
      calls.push({ offerId, applicationBriefResult, signal });
      return await request(offerId, applicationBriefResult, signal);
    },
    updateState(next) {
      state.visible = next;
      state.updateCount += 1;
    },
    getSelectedOfferId() {
      return state.selectedOfferId;
    },
    getApplicationBriefResult() {
      return state.applicationBriefResult;
    },
    onRefreshRequired() {
      state.refreshCount += 1;
    },
  });
  return { orchestrator, state, calls };
}

test("generation moves idle through loading to success with captured pair", async () => {
  const deferred = createDeferred();
  const harness = createHarness(() => {
    return deferred.promise;
  });
  const capturedResult = harness.state.applicationBriefResult;
  const first = harness.orchestrator.generate();
  const second = harness.orchestrator.generate();
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].applicationBriefResult, capturedResult);
  assert.equal(harness.calls[0].signal instanceof globalThis.AbortSignal, true);
  assert.equal(harness.state.visible.uiStatus, CoverLetterConstants.UI_STATUS.LOADING);
  deferred.resolve(createCoverLetter());
  await Promise.all([first, second]);
  assert.deepEqual(harness.state.visible, {
    uiStatus: CoverLetterConstants.UI_STATUS.SUCCESS,
    offerId: OFFER_A_ID,
    applicationBriefResult: capturedResult,
    coverLetter: createCoverLetter(),
    error: null,
  });
});

test("offer change makes success and error stale", async () => {
  for (const settlement of ["success", "error"]) {
    const deferred = createDeferred();
    const harness = createHarness(() => {
      return deferred.promise;
    });
    const pending = harness.orchestrator.generate();
    harness.state.selectedOfferId = OFFER_B_ID;
    if (settlement === "success") {
      deferred.resolve(createCoverLetter());
    } else {
      deferred.reject(new Error("private stale failure"));
    }
    await pending;
    assert.equal(harness.state.visible.uiStatus, CoverLetterConstants.UI_STATUS.LOADING);
    assert.equal(harness.state.refreshCount, 0);
  }
});

test("new JSON-identical result reference makes the previous response stale", async () => {
  const deferred = createDeferred();
  const harness = createHarness(() => {
    return deferred.promise;
  });
  const resultA = harness.state.applicationBriefResult;
  const resultB = globalThis.structuredClone(resultA);
  assert.deepEqual(resultB, resultA);
  assert.notEqual(resultB, resultA);
  const pending = harness.orchestrator.generate();
  harness.state.applicationBriefResult = resultB;
  deferred.resolve(createCoverLetter());
  await pending;
  assert.equal(harness.state.visible.uiStatus, CoverLetterConstants.UI_STATUS.LOADING);
  assert.equal(harness.state.visible.coverLetter, null);
});

test("invalidate and dispose abort requests and prevent stale installation", async () => {
  for (const lifecycle of ["invalidate", "dispose"]) {
    const deferred = createDeferred();
    const harness = createHarness(() => {
      return deferred.promise;
    });
    const pending = harness.orchestrator.generate();
    const signal = harness.calls[0].signal;
    const updateCount = harness.state.updateCount;
    if (lifecycle === "invalidate") {
      harness.orchestrator.invalidate(
        harness.state.selectedOfferId,
        harness.state.applicationBriefResult,
      );
      assert.deepEqual(harness.state.visible, createCoverLetterState(
        harness.state.selectedOfferId,
        harness.state.applicationBriefResult,
      ));
    } else {
      harness.orchestrator.dispose();
      assert.equal(harness.state.updateCount, updateCount);
    }
    assert.equal(signal.aborted, true);
    deferred.resolve(createCoverLetter());
    await pending;
    if (lifecycle === "dispose") {
      assert.equal(harness.state.updateCount, updateCount);
    }
  }
});

test("AbortError is silent and current classified errors remain closed", async () => {
  const abortError = new Error("private abort");
  abortError.name = "AbortError";
  const abortHarness = createHarness(async () => {
    throw abortError;
  });
  await abortHarness.orchestrator.generate();
  assert.equal(abortHarness.state.visible.uiStatus, CoverLetterConstants.UI_STATUS.LOADING);
  assert.equal(abortHarness.state.visible.error, null);

  for (const [status, code] of [
    [422, "INSUFFICIENT_SUPPORTED_CLAIMS"],
    [503, "COVER_LETTER_UNAVAILABLE"],
  ]) {
    const harness = createHarness(async () => {
      const error = new Error("private provider message");
      error.status = status;
      error.code = code;
      throw error;
    });
    await harness.orchestrator.generate();
    assert.deepEqual(harness.state.visible.error, { status, code });
    assert.equal(harness.state.visible.coverLetter, null);
  }
});

test("refresh required is exposed and callback runs only for a current request", async () => {
  const currentHarness = createHarness(async () => {
    const error = new Error("private");
    error.status = 409;
    error.code = "APPLICATION_BRIEF_REFRESH_REQUIRED";
    throw error;
  });
  const currentResult = currentHarness.state.applicationBriefResult;
  await currentHarness.orchestrator.generate();
  assert.equal(currentHarness.state.refreshCount, 1);
  assert.equal(currentHarness.state.visible.applicationBriefResult, currentResult);
  assert.deepEqual(currentHarness.state.visible.error, {
    status: 409,
    code: "APPLICATION_BRIEF_REFRESH_REQUIRED",
  });

  const deferred = createDeferred();
  const staleHarness = createHarness(() => {
    return deferred.promise;
  });
  const pending = staleHarness.orchestrator.generate();
  staleHarness.state.applicationBriefResult = createBriefResult("token-b");
  const staleError = new Error("private");
  staleError.status = 409;
  staleError.code = "APPLICATION_BRIEF_REFRESH_REQUIRED";
  deferred.reject(staleError);
  await pending;
  assert.equal(staleHarness.state.refreshCount, 0);
});

test("same result can regenerate and replace the previous letter", async () => {
  let attempt = 0;
  const harness = createHarness(async () => {
    attempt += 1;
    return createCoverLetter(`Letter ${attempt}`);
  });
  await harness.orchestrator.generate();
  await harness.orchestrator.generate();
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.calls[0].applicationBriefResult, harness.calls[1].applicationBriefResult);
  assert.equal(harness.state.visible.coverLetter.letter, "Letter 2");
});

test("stale finally cannot release the lock owned by a newer request", async () => {
  const firstDeferred = createDeferred();
  const secondDeferred = createDeferred();
  const deferreds = [firstDeferred, secondDeferred];
  const harness = createHarness(() => {
    return deferreds[harness.calls.length - 1].promise;
  });
  const firstPending = harness.orchestrator.generate();
  harness.orchestrator.invalidate(
    harness.state.selectedOfferId,
    harness.state.applicationBriefResult,
  );
  const secondPending = harness.orchestrator.generate();
  firstDeferred.resolve(createCoverLetter("old"));
  await firstPending;
  await harness.orchestrator.generate();
  assert.equal(harness.calls.length, 2);
  secondDeferred.resolve(createCoverLetter("current"));
  await secondPending;
  assert.equal(harness.state.visible.coverLetter.letter, "current");
});

test("invalid context never starts a generation", async () => {
  const harness = createHarness(async () => {
    return createCoverLetter();
  });
  harness.state.applicationBriefResult = null;
  await harness.orchestrator.generate();
  harness.state.applicationBriefResult = createBriefResult();
  harness.state.selectedOfferId = null;
  await harness.orchestrator.generate();
  assert.deepEqual(harness.calls, []);
});
