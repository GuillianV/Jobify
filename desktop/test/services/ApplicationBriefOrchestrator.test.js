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
 * Build one observable orchestrator harness.
 * @param {Function} request - Injected generation request.
 * @returns {object} Harness.
 */
function createHarness(request) {
  const state = { selectedOfferId: OFFER_A_ID, visible: createApplicationBriefState() };
  const calls = [];
  const orchestrator = new ApplicationBriefOrchestrator({
    async generateApplicationBrief(offerId) {
      calls.push(offerId);
      return await request(offerId);
    },
    updateState(next) {
      state.visible = next;
    },
    getSelectedOfferId() {
      return state.selectedOfferId;
    },
  });
  return { orchestrator, state, calls };
}

test("explicit analysis moves idle through loading to one success", async () => {
  const deferred = createDeferred();
  const harness = createHarness(() => {
    return deferred.promise;
  });
  harness.orchestrator.openOffer(OFFER_A_ID);
  assert.deepEqual(harness.state.visible, createApplicationBriefState(OFFER_A_ID));
  const first = harness.orchestrator.analyze();
  const second = harness.orchestrator.analyze();
  assert.deepEqual(harness.calls, [OFFER_A_ID]);
  assert.equal(harness.state.visible.uiStatus, ApplicationBriefConstants.UI_STATUS.LOADING);
  deferred.resolve({ requirementMatches: [] });
  await Promise.all([first, second]);
  assert.equal(harness.state.visible.uiStatus, ApplicationBriefConstants.UI_STATUS.SUCCESS);
  assert.deepEqual(harness.state.visible.brief, { requirementMatches: [] });
});

test("request failure is safe and retry is manual", async () => {
  let attempt = 0;
  const harness = createHarness(async () => {
    attempt += 1;
    if (attempt === 1) {
      const error = new Error("private");
      error.status = 503;
      error.code = "APPLICATION_BRIEF_UNAVAILABLE";
      throw error;
    }
    return { requirementMatches: [] };
  });
  harness.orchestrator.openOffer(OFFER_A_ID);
  await harness.orchestrator.analyze();
  assert.deepEqual(harness.state.visible.error, {
    status: 503,
    code: "APPLICATION_BRIEF_UNAVAILABLE",
  });
  assert.equal(attempt, 1);
  await harness.orchestrator.retry();
  assert.equal(attempt, 2);
  assert.equal(harness.state.visible.uiStatus, ApplicationBriefConstants.UI_STATUS.SUCCESS);
});

test("offer change ignores the previous offer result", async () => {
  const deferred = createDeferred();
  const harness = createHarness(() => {
    return deferred.promise;
  });
  harness.orchestrator.openOffer(OFFER_A_ID);
  const pending = harness.orchestrator.analyze();
  harness.state.selectedOfferId = OFFER_B_ID;
  harness.orchestrator.openOffer(OFFER_B_ID);
  deferred.resolve({ from: "offer-a" });
  await pending;
  assert.deepEqual(harness.state.visible, createApplicationBriefState(OFFER_B_ID));
});

test("offer change ignores a late error from the previous offer", async () => {
  const deferred = createDeferred();
  const harness = createHarness(() => {
    return deferred.promise;
  });
  harness.orchestrator.openOffer(OFFER_A_ID);
  const pending = harness.orchestrator.analyze();
  harness.state.selectedOfferId = OFFER_B_ID;
  harness.orchestrator.openOffer(OFFER_B_ID);
  deferred.reject(new Error("private stale error"));
  await pending;
  assert.deepEqual(harness.state.visible, createApplicationBriefState(OFFER_B_ID));
  assert.deepEqual(harness.calls, [OFFER_A_ID]);
});

test("close or dirty invalidation ignores pending results and clears visible success", async () => {
  const deferred = createDeferred();
  const harness = createHarness(() => {
    return deferred.promise;
  });
  harness.orchestrator.openOffer(OFFER_A_ID);
  const pending = harness.orchestrator.analyze();
  harness.orchestrator.invalidate(OFFER_A_ID);
  deferred.resolve({ stale: true });
  await pending;
  assert.deepEqual(harness.state.visible, createApplicationBriefState(OFFER_A_ID));

  const successHarness = createHarness(async () => {
    return { current: true };
  });
  successHarness.orchestrator.openOffer(OFFER_A_ID);
  await successHarness.orchestrator.analyze();
  successHarness.orchestrator.invalidate(OFFER_A_ID);
  assert.deepEqual(successHarness.state.visible, createApplicationBriefState(OFFER_A_ID));
});

test("invalid or absent selection never starts a request", async () => {
  const harness = createHarness(async () => {
    return {};
  });
  harness.state.selectedOfferId = null;
  await harness.orchestrator.analyze();
  assert.deepEqual(harness.calls, []);
});
