import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationBriefConstants } from "../../src/constants/ApplicationBriefConstants.js";
import {
  ApplicationBriefOrchestrator,
  createApplicationBriefState,
} from "../../src/services/ApplicationBriefOrchestrator.js";

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
 * Build one atomic result fixture.
 * @param {string} token - Opaque token fixture.
 * @returns {object} Result fixture.
 */
function createResult(token = "token-a") {
  return { brief: { requirementMatches: [] }, generationToken: token };
}

/**
 * Build one observable orchestrator harness.
 * @param {Function} request - Injected generation request.
 * @returns {object} Harness.
 */
function createHarness(request) {
  const state = {
    selectedOfferId: OFFER_A_ID,
    visible: createApplicationBriefState(),
    updateCount: 0,
  };
  const calls = [];
  const orchestrator = new ApplicationBriefOrchestrator({
    async generateApplicationBrief(offerId, requestImplementation, signal) {
      calls.push({ offerId, signal });
      return await request(offerId, signal);
    },
    updateState(next) {
      state.visible = next;
      state.updateCount += 1;
    },
    getSelectedOfferId() {
      return state.selectedOfferId;
    },
  });
  return { orchestrator, state, calls };
}

test("analysis installs one atomic result and blocks a synchronous duplicate", async () => {
  const deferred = createDeferred();
  const result = createResult();
  const harness = createHarness(() => {
    return deferred.promise;
  });
  harness.orchestrator.openOffer(OFFER_A_ID);
  const first = harness.orchestrator.analyze();
  const second = harness.orchestrator.analyze();
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].signal instanceof globalThis.AbortSignal, true);
  assert.deepEqual(harness.state.visible, {
    uiStatus: ApplicationBriefConstants.UI_STATUS.LOADING,
    offerId: OFFER_A_ID,
    result: null,
    error: null,
  });
  deferred.resolve(result);
  await Promise.all([first, second]);
  assert.deepEqual(harness.state.visible, {
    uiStatus: ApplicationBriefConstants.UI_STATUS.SUCCESS,
    offerId: OFFER_A_ID,
    result,
    error: null,
  });
});

test("loading error open and invalidate always clear the complete pair", async () => {
  const result = createResult();
  let attempt = 0;
  const harness = createHarness(async () => {
    attempt += 1;
    if (attempt === 1) {
      return result;
    }
    const error = new Error("private");
    error.status = 503;
    error.code = "APPLICATION_BRIEF_UNAVAILABLE";
    throw error;
  });
  harness.orchestrator.openOffer(OFFER_A_ID);
  await harness.orchestrator.analyze();
  const pending = harness.orchestrator.retry();
  assert.equal(harness.state.visible.result, null);
  await pending;
  assert.deepEqual(harness.state.visible.error, {
    status: 503,
    code: "APPLICATION_BRIEF_UNAVAILABLE",
  });
  assert.equal(harness.state.visible.result, null);
  harness.orchestrator.openOffer(OFFER_B_ID);
  assert.deepEqual(harness.state.visible, createApplicationBriefState(OFFER_B_ID));
  harness.orchestrator.invalidate();
  assert.deepEqual(harness.state.visible, createApplicationBriefState());
});

test("offer change aborts and ignores stale success and stale error", async () => {
  for (const settlement of ["success", "error"]) {
    const deferred = createDeferred();
    const harness = createHarness(() => {
      return deferred.promise;
    });
    harness.orchestrator.openOffer(OFFER_A_ID);
    const pending = harness.orchestrator.analyze();
    const signal = harness.calls[0].signal;
    harness.state.selectedOfferId = OFFER_B_ID;
    harness.orchestrator.openOffer(OFFER_B_ID);
    assert.equal(signal.aborted, true);
    if (settlement === "success") {
      deferred.resolve(createResult());
    } else {
      deferred.reject(new Error("private stale error"));
    }
    await pending;
    assert.deepEqual(harness.state.visible, createApplicationBriefState(OFFER_B_ID));
  }
});

test("invalidate and dispose abort while dispose performs no state update", async () => {
  const firstDeferred = createDeferred();
  const firstHarness = createHarness(() => {
    return firstDeferred.promise;
  });
  firstHarness.orchestrator.openOffer(OFFER_A_ID);
  const firstPending = firstHarness.orchestrator.analyze();
  const firstSignal = firstHarness.calls[0].signal;
  firstHarness.orchestrator.invalidate(OFFER_A_ID);
  assert.equal(firstSignal.aborted, true);
  firstDeferred.resolve(createResult());
  await firstPending;

  const secondDeferred = createDeferred();
  const secondHarness = createHarness(() => {
    return secondDeferred.promise;
  });
  secondHarness.orchestrator.openOffer(OFFER_A_ID);
  const secondPending = secondHarness.orchestrator.analyze();
  const updateCount = secondHarness.state.updateCount;
  const secondSignal = secondHarness.calls[0].signal;
  secondHarness.orchestrator.dispose();
  assert.equal(secondSignal.aborted, true);
  assert.equal(secondHarness.state.updateCount, updateCount);
  secondDeferred.resolve(createResult());
  await secondPending;
  assert.equal(secondHarness.state.updateCount, updateCount);
});

test("AbortError is silent while a current non-abort failure is visible", async () => {
  const abortError = new Error("aborted");
  abortError.name = "AbortError";
  const harness = createHarness(async () => {
    throw abortError;
  });
  harness.orchestrator.openOffer(OFFER_A_ID);
  await harness.orchestrator.analyze();
  assert.equal(harness.state.visible.uiStatus, ApplicationBriefConstants.UI_STATUS.LOADING);
  assert.equal(harness.state.visible.error, null);
});

test("stale finally cannot release the lock owned by a newer request", async () => {
  const firstDeferred = createDeferred();
  const secondDeferred = createDeferred();
  const deferreds = [firstDeferred, secondDeferred];
  const harness = createHarness(() => {
    return deferreds[harness.calls.length - 1].promise;
  });
  harness.orchestrator.openOffer(OFFER_A_ID);
  const firstPending = harness.orchestrator.analyze();
  harness.orchestrator.invalidate(OFFER_A_ID);
  const secondPending = harness.orchestrator.analyze();
  firstDeferred.resolve(createResult("token-old"));
  await firstPending;
  await harness.orchestrator.analyze();
  assert.equal(harness.calls.length, 2);
  secondDeferred.resolve(createResult("token-current"));
  await secondPending;
  assert.equal(harness.state.visible.result.generationToken, "token-current");
});

test("invalid or absent selection never starts a request", async () => {
  const harness = createHarness(async () => {
    return createResult();
  });
  harness.state.selectedOfferId = null;
  await harness.orchestrator.analyze();
  assert.deepEqual(harness.calls, []);
});
