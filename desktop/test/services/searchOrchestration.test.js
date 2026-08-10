import test from "node:test";
import assert from "node:assert/strict";
import {
  claimInitialSearch,
  runLatestSearch,
} from "../../src/services/searchOrchestration.js";

const STATUS_LOADING = "loading";
const STATUS_OK = "ok";
const STATUS_ERROR = "error";

/**
 * Create one externally controlled promise.
 * @returns {object} Promise and settlement callbacks.
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
 * Create observable state setters and one latest-search runner.
 * @returns {object} State, request ref and runner factory.
 */
function createContext() {
  const state = { offers: [], status: null, error: null };
  const requestIdRef = { current: 0 };
  return {
    state,
    run(search) {
      return runLatestSearch({
        requestIdRef,
        search,
        setOffers(offers) {
          state.offers = offers;
        },
        setStatus(status) {
          state.status = status;
        },
        setError(error) {
          state.error = error;
        },
        loadingStatus: STATUS_LOADING,
        successStatus: STATUS_OK,
        errorStatus: STATUS_ERROR,
      });
    },
  };
}

test("repeated StrictMode effect setup claims one automatic search", () => {
  const didRunInitialSearch = { current: false };
  let searchCount = 0;
  for (const setup of [claimInitialSearch, claimInitialSearch]) {
    if (setup(didRunInitialSearch)) {
      searchCount += 1;
    }
  }

  assert.equal(searchCount, 1);
});

test("latest search wins when an older response resolves last", async () => {
  const context = createContext();
  const first = createDeferred();
  const second = createDeferred();
  const firstRun = context.run(() => {
    return first.promise;
  });
  const secondRun = context.run(() => {
    return second.promise;
  });

  second.resolve(["offer B"]);
  await secondRun;
  first.resolve(["offer A"]);
  await firstRun;

  assert.deepEqual(context.state.offers, ["offer B"]);
  assert.equal(context.state.status, STATUS_OK);
  assert.equal(context.state.error, null);
});

test("stale search error cannot replace newer success or loading state", async () => {
  const context = createContext();
  const first = createDeferred();
  const second = createDeferred();
  const firstRun = context.run(() => {
    return first.promise;
  });
  const secondRun = context.run(() => {
    return second.promise;
  });

  second.resolve(["offer B"]);
  await secondRun;
  first.reject(new Error("stale failure"));
  await firstRun;

  assert.deepEqual(context.state.offers, ["offer B"]);
  assert.equal(context.state.status, STATUS_OK);
  assert.equal(context.state.error, null);
});

test("one normal search preserves historical loading success and error behavior", async () => {
  const success = createContext();
  const successRun = success.run(async () => {
    assert.equal(success.state.status, STATUS_LOADING);
    assert.equal(success.state.error, null);
    return ["offer"];
  });
  await successRun;

  assert.deepEqual(success.state.offers, ["offer"]);
  assert.equal(success.state.status, STATUS_OK);
  assert.equal(success.state.error, null);

  const failure = createContext();
  await failure.run(async () => {
    throw new Error("active failure");
  });

  assert.deepEqual(failure.state.offers, []);
  assert.equal(failure.state.status, STATUS_ERROR);
  assert.equal(failure.state.error, "active failure");
});
