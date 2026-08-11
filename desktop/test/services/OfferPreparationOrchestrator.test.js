import test from "node:test";
import assert from "node:assert/strict";
import {
  createPreparationState,
  isValidUserTextDraft,
  OfferPreparationOrchestrator,
} from "../../src/services/OfferPreparationOrchestrator.js";
import { OfferPreparationConstants } from "../../src/constants/OfferPreparationConstants.js";

const OFFER_A_ID = 42;
const OFFER_B_ID = 43;
const AUTOMATIC_DESCRIPTION = "Automatic provider text";
const PROVIDER_URL = "https://www.hellowork.com/fr-fr/emplois/123.html";

/**
 * Build one deferred promise for race tests.
 * @returns {object} Promise with external resolve and reject controls.
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
 * Wait for already scheduled asynchronous continuations.
 * @returns {Promise<void>} Resolves on the next event-loop turn.
 */
async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Build the recognized HelloWork provider instruction.
 * @returns {object} Provider instruction.
 */
function createProviderAcquisition() {
  return {
    kind: OfferPreparationConstants.PROVIDER_ACQUISITION_KIND.HELLOWORK_DETAIL,
    source: OfferPreparationConstants.PROVIDER_SOURCE.HELLOWORK,
    url: PROVIDER_URL,
  };
}

/**
 * Build a validated server-shaped preparation envelope.
 * @param {string} prepareStatus - Server status.
 * @param {object} [overrides] - Values replacing defaults.
 * @returns {object} Preparation envelope.
 */
function createEnvelope(prepareStatus, overrides = {}) {
  const { offerId = OFFER_A_ID, ...envelopeOverrides } = overrides;
  return {
    prepareStatus,
    evaluation: { status: prepareStatus === OfferPreparationConstants.PREPARE_STATUS.READY
      ? "SUFFICIENT"
      : "INSUFFICIENT" },
    offre: { id: offerId, description: AUTOMATIC_DESCRIPTION },
    userContent: null,
    providerAcquisition: null,
    ...envelopeOverrides,
  };
}

/**
 * Create an observable orchestration context with injected operations.
 * @param {object} [operations] - Overrides for async dependencies.
 * @returns {object} Orchestrator, mutable state and captured calls.
 */
function createContext(operations = {}) {
  const state = {
    preparation: createPreparationState(),
    selectedOfferId: null,
    appliedOffers: [],
  };
  const calls = { prepare: 0, provider: 0, patch: 0, userText: 0 };
  const orchestrator = new OfferPreparationOrchestrator({
    async prepareOffer(id) {
      calls.prepare += 1;
      return operations.prepareOffer
        ? operations.prepareOffer(id)
        : createEnvelope(OfferPreparationConstants.PREPARE_STATUS.READY, { offerId: id });
    },
    async submitUserContent(id, text) {
      calls.userText += 1;
      return operations.submitUserContent
        ? operations.submitUserContent(id, text)
        : createEnvelope(OfferPreparationConstants.PREPARE_STATUS.READY, { offerId: id });
    },
    async persistProviderContent(id, detail) {
      calls.patch += 1;
      return operations.persistProviderContent
        ? operations.persistProviderContent(id, detail)
        : createEnvelope(OfferPreparationConstants.PREPARE_STATUS.READY, { offerId: id });
    },
    async acquireProviderContent(instruction, fetchDetail) {
      calls.provider += 1;
      return operations.acquireProviderContent
        ? operations.acquireProviderContent(instruction, fetchDetail)
        : { status: OfferPreparationConstants.IPC_STATUS.NOT_FOUND };
    },
    async fetchDetail() {
      throw new Error("The injected provider adapter owns the bridge in tests");
    },
    applyOffer(offer) {
      state.appliedOffers.push(offer);
    },
    updateState(update) {
      state.preparation = typeof update === "function"
        ? update(state.preparation)
        : update;
    },
    getState() {
      return state.preparation;
    },
    getSelectedOfferId() {
      return state.selectedOfferId;
    },
  });
  return {
    calls,
    orchestrator,
    state,
    open(offerId) {
      state.selectedOfferId = offerId;
      orchestrator.openOffer(offerId);
    },
    close() {
      state.selectedOfferId = null;
      orchestrator.closeOffer();
    },
  };
}

test("opening an offer is read-only and resets preparation to idle", () => {
  const context = createContext();

  context.open(OFFER_A_ID);

  assert.equal(context.state.preparation.uiStatus, OfferPreparationConstants.UI_STATUS.IDLE);
  assert.equal(context.state.preparation.offerId, OFFER_A_ID);
  assert.deepEqual(context.calls, { prepare: 0, provider: 0, patch: 0, userText: 0 });
});

test("READY performs one POST and no provider or generation operation", async () => {
  const context = createContext();
  context.open(OFFER_A_ID);

  await context.orchestrator.prepare();

  assert.equal(context.calls.prepare, 1);
  assert.equal(context.calls.provider, 0);
  assert.equal(context.calls.patch, 0);
  assert.equal(context.state.preparation.uiStatus, OfferPreparationConstants.UI_STATUS.READY);
});

test("provider ACQUIRED performs one IPC and PATCH without a second POST", async () => {
  const detail = { description: "DETAIL", sourceUrl: PROVIDER_URL };
  const providerAcquisition = createProviderAcquisition();
  const context = createContext({
    async prepareOffer() {
      return createEnvelope(
        OfferPreparationConstants.PREPARE_STATUS.NEEDS_PROVIDER_ACQUISITION,
        { providerAcquisition },
      );
    },
    async acquireProviderContent(instruction) {
      assert.equal(instruction, providerAcquisition);
      return { status: OfferPreparationConstants.IPC_STATUS.ACQUIRED, detail };
    },
    async persistProviderContent(id, receivedDetail) {
      assert.equal(id, OFFER_A_ID);
      assert.equal(receivedDetail, detail);
      return createEnvelope(OfferPreparationConstants.PREPARE_STATUS.READY);
    },
  });
  context.open(OFFER_A_ID);

  await context.orchestrator.prepare();

  assert.deepEqual(context.calls, { prepare: 1, provider: 1, patch: 1, userText: 0 });
  assert.equal(context.state.preparation.uiStatus, OfferPreparationConstants.UI_STATUS.READY);
  assert.equal(context.state.preparation.pendingDetail, null);
});

test("NOT_FOUND falls back to user text and retries provider only explicitly", async () => {
  const providerAcquisition = createProviderAcquisition();
  const detail = { description: "DETAIL", sourceUrl: PROVIDER_URL };
  let acquisitionAttempt = 0;
  const context = createContext({
    async prepareOffer() {
      return createEnvelope(
        OfferPreparationConstants.PREPARE_STATUS.NEEDS_PROVIDER_ACQUISITION,
        { providerAcquisition },
      );
    },
    async acquireProviderContent() {
      acquisitionAttempt += 1;
      return acquisitionAttempt === 1
        ? { status: OfferPreparationConstants.IPC_STATUS.NOT_FOUND }
        : { status: OfferPreparationConstants.IPC_STATUS.ACQUIRED, detail };
    },
  });
  context.open(OFFER_A_ID);

  await context.orchestrator.prepare();

  assert.equal(context.state.preparation.uiStatus,
    OfferPreparationConstants.UI_STATUS.NEEDS_USER_TEXT);
  assert.equal(context.state.preparation.error, null);
  assert.equal(context.state.preparation.retryKind,
    OfferPreparationConstants.RETRY_KIND.PROVIDER);
  assert.equal(context.calls.patch, 0);

  await context.orchestrator.retry();

  assert.deepEqual(context.calls, { prepare: 1, provider: 2, patch: 1, userText: 0 });
});

test("FAILED exposes only the generic fallback message and no PATCH", async () => {
  const context = createContext({
    async prepareOffer() {
      return createEnvelope(
        OfferPreparationConstants.PREPARE_STATUS.NEEDS_PROVIDER_ACQUISITION,
        { providerAcquisition: createProviderAcquisition() },
      );
    },
    async acquireProviderContent() {
      return { status: OfferPreparationConstants.IPC_STATUS.FAILED };
    },
  });
  context.open(OFFER_A_ID);

  await context.orchestrator.prepare();

  assert.equal(context.calls.patch, 0);
  assert.equal(context.state.preparation.uiStatus,
    OfferPreparationConstants.UI_STATUS.NEEDS_USER_TEXT);
  assert.equal(
    context.state.preparation.error.message,
    OfferPreparationConstants.MESSAGE.PROVIDER_FAILED,
  );
});

test("failed POST exposes an explicit prepare retry", async () => {
  let attempt = 0;
  const context = createContext({
    async prepareOffer() {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("HTTP failure");
      }
      return createEnvelope(OfferPreparationConstants.PREPARE_STATUS.READY);
    },
  });
  context.open(OFFER_A_ID);

  await context.orchestrator.prepare();

  assert.equal(context.state.preparation.uiStatus, OfferPreparationConstants.UI_STATUS.ERROR);
  assert.equal(context.state.preparation.retryKind,
    OfferPreparationConstants.RETRY_KIND.PREPARE);

  await context.orchestrator.retry();

  assert.equal(context.calls.prepare, 2);
  assert.equal(context.state.preparation.uiStatus, OfferPreparationConstants.UI_STATUS.READY);
});

test("failed PATCH retains DETAIL and explicit retry does not repeat IPC", async () => {
  const detail = { description: "DETAIL", sourceUrl: PROVIDER_URL };
  let patchAttempt = 0;
  const context = createContext({
    async prepareOffer() {
      return createEnvelope(
        OfferPreparationConstants.PREPARE_STATUS.NEEDS_PROVIDER_ACQUISITION,
        { providerAcquisition: createProviderAcquisition() },
      );
    },
    async acquireProviderContent() {
      return { status: OfferPreparationConstants.IPC_STATUS.ACQUIRED, detail };
    },
    async persistProviderContent() {
      patchAttempt += 1;
      if (patchAttempt === 1) {
        throw new Error("HTTP failure");
      }
      return createEnvelope(OfferPreparationConstants.PREPARE_STATUS.READY);
    },
  });
  context.open(OFFER_A_ID);

  await context.orchestrator.prepare();

  assert.equal(context.state.preparation.pendingDetail, detail);
  assert.equal(context.state.preparation.retryKind,
    OfferPreparationConstants.RETRY_KIND.PERSIST_PROVIDER);

  await context.orchestrator.retry();

  assert.equal(context.calls.provider, 1);
  assert.equal(context.calls.patch, 2);
  assert.equal(context.state.preparation.uiStatus, OfferPreparationConstants.UI_STATUS.READY);
});

test("provider request returned after PATCH falls back without an automatic loop", async () => {
  const providerAcquisition = createProviderAcquisition();
  const detail = { description: "DETAIL", sourceUrl: PROVIDER_URL };
  const context = createContext({
    async prepareOffer() {
      return createEnvelope(
        OfferPreparationConstants.PREPARE_STATUS.NEEDS_PROVIDER_ACQUISITION,
        { providerAcquisition },
      );
    },
    async acquireProviderContent() {
      return { status: OfferPreparationConstants.IPC_STATUS.ACQUIRED, detail };
    },
    async persistProviderContent() {
      return createEnvelope(
        OfferPreparationConstants.PREPARE_STATUS.NEEDS_PROVIDER_ACQUISITION,
        { providerAcquisition },
      );
    },
  });
  context.open(OFFER_A_ID);

  await context.orchestrator.prepare();

  assert.deepEqual(context.calls, { prepare: 1, provider: 1, patch: 1, userText: 0 });
  assert.equal(context.state.preparation.uiStatus,
    OfferPreparationConstants.UI_STATUS.NEEDS_USER_TEXT);
  assert.equal(context.state.preparation.retryKind,
    OfferPreparationConstants.RETRY_KIND.PROVIDER);
});

test("direct NEEDS_USER_TEXT never acquires provider content", async () => {
  const context = createContext({
    async prepareOffer() {
      return createEnvelope(OfferPreparationConstants.PREPARE_STATUS.NEEDS_USER_TEXT);
    },
  });
  context.open(OFFER_A_ID);

  await context.orchestrator.prepare();

  assert.equal(context.calls.provider, 0);
  assert.equal(context.state.preparation.uiStatus,
    OfferPreparationConstants.UI_STATUS.NEEDS_USER_TEXT);
});

test("user text validation rejects empty and oversized drafts before PUT", async () => {
  const context = createContext();
  context.open(OFFER_A_ID);
  context.state.preparation = {
    ...context.state.preparation,
    uiStatus: OfferPreparationConstants.UI_STATUS.NEEDS_USER_TEXT,
  };

  context.orchestrator.updateUserTextDraft("   ");
  await context.orchestrator.submitUserText();
  context.orchestrator.updateUserTextDraft(
    "x".repeat(OfferPreparationConstants.MAXIMUM_USER_TEXT_LENGTH + 1),
  );
  await context.orchestrator.submitUserText();

  assert.equal(isValidUserTextDraft("   "), false);
  assert.equal(isValidUserTextDraft(
    "x".repeat(OfferPreparationConstants.MAXIMUM_USER_TEXT_LENGTH + 1),
  ), false);
  assert.equal(context.calls.userText, 0);
});

test("PUT READY keeps user content separate from automatic description", async () => {
  const userContent = { text: "User text", providedAt: "2026-08-11T10:00:00.000Z" };
  const context = createContext({
    async submitUserContent() {
      return createEnvelope(OfferPreparationConstants.PREPARE_STATUS.READY, { userContent });
    },
  });
  context.open(OFFER_A_ID);
  context.orchestrator.updateUserTextDraft(userContent.text);

  await context.orchestrator.submitUserText();

  assert.equal(context.calls.userText, 1);
  assert.equal(context.state.appliedOffers[0].description, AUTOMATIC_DESCRIPTION);
  assert.equal(context.state.preparation.userContent.text, userContent.text);
  assert.equal(context.state.preparation.uiStatus, OfferPreparationConstants.UI_STATUS.READY);
});

test("PUT NEEDS_USER_TEXT retains the form and synchronizes the server user text", async () => {
  const userContent = { text: "Server user text", providedAt: "2026-08-11T10:00:00.000Z" };
  const context = createContext({
    async submitUserContent() {
      return createEnvelope(
        OfferPreparationConstants.PREPARE_STATUS.NEEDS_USER_TEXT,
        { userContent },
      );
    },
  });
  context.open(OFFER_A_ID);
  context.orchestrator.updateUserTextDraft("Submitted draft");

  await context.orchestrator.submitUserText();

  assert.equal(context.state.preparation.uiStatus,
    OfferPreparationConstants.UI_STATUS.NEEDS_USER_TEXT);
  assert.equal(context.state.preparation.userTextDraft, userContent.text);
});

test("failed PUT retains the draft and retries only user-text persistence", async () => {
  let attempt = 0;
  const context = createContext({
    async submitUserContent(id, text) {
      attempt += 1;
      assert.equal(id, OFFER_A_ID);
      assert.equal(text, "Retained draft");
      if (attempt === 1) {
        throw new Error("HTTP failure");
      }
      return createEnvelope(OfferPreparationConstants.PREPARE_STATUS.READY, {
        userContent: { text, providedAt: "2026-08-11T10:00:00.000Z" },
      });
    },
  });
  context.open(OFFER_A_ID);
  context.orchestrator.updateUserTextDraft("Retained draft");

  await context.orchestrator.submitUserText();

  assert.equal(context.state.preparation.userTextDraft, "Retained draft");
  assert.equal(context.state.preparation.retryKind,
    OfferPreparationConstants.RETRY_KIND.USER_TEXT);

  await context.orchestrator.retry();

  assert.equal(context.calls.userText, 2);
  assert.equal(context.calls.provider, 0);
  assert.equal(context.state.preparation.uiStatus, OfferPreparationConstants.UI_STATUS.READY);
});

test("closing during POST applies A to the list without reopening visible state", async () => {
  const deferred = createDeferred();
  const context = createContext({
    async prepareOffer() {
      return deferred.promise;
    },
  });
  context.open(OFFER_A_ID);
  const preparation = context.orchestrator.prepare();
  context.close();
  deferred.resolve(createEnvelope(OfferPreparationConstants.PREPARE_STATUS.READY));

  await preparation;

  assert.equal(context.state.selectedOfferId, null);
  assert.equal(context.state.preparation.offerId, null);
  assert.equal(context.state.preparation.uiStatus, OfferPreparationConstants.UI_STATUS.IDLE);
  assert.equal(context.state.appliedOffers.length, 1);
});

test("A to B during POST leaves B visible while A updates the list", async () => {
  const deferred = createDeferred();
  const context = createContext({
    async prepareOffer() {
      return deferred.promise;
    },
  });
  context.open(OFFER_A_ID);
  const preparation = context.orchestrator.prepare();
  context.open(OFFER_B_ID);
  deferred.resolve(createEnvelope(OfferPreparationConstants.PREPARE_STATUS.READY));

  await preparation;

  assert.equal(context.state.selectedOfferId, OFFER_B_ID);
  assert.equal(context.state.preparation.offerId, OFFER_B_ID);
  assert.equal(context.state.preparation.uiStatus, OfferPreparationConstants.UI_STATUS.IDLE);
});

test("A to B during IPC still persists A without changing B preparation state", async () => {
  const deferred = createDeferred();
  const detail = { description: "DETAIL", sourceUrl: PROVIDER_URL };
  const context = createContext({
    async prepareOffer() {
      return createEnvelope(
        OfferPreparationConstants.PREPARE_STATUS.NEEDS_PROVIDER_ACQUISITION,
        { providerAcquisition: createProviderAcquisition() },
      );
    },
    async acquireProviderContent() {
      return deferred.promise;
    },
  });
  context.open(OFFER_A_ID);
  const preparation = context.orchestrator.prepare();
  await flushAsyncWork();
  context.open(OFFER_B_ID);
  deferred.resolve({ status: OfferPreparationConstants.IPC_STATUS.ACQUIRED, detail });

  await preparation;

  assert.equal(context.calls.patch, 1);
  assert.equal(context.state.selectedOfferId, OFFER_B_ID);
  assert.equal(context.state.preparation.offerId, OFFER_B_ID);
  assert.equal(context.state.appliedOffers.at(-1).id, OFFER_A_ID);
});

test("A to B during PUT applies A without changing B visible preparation", async () => {
  const deferred = createDeferred();
  const context = createContext({
    async submitUserContent() {
      return deferred.promise;
    },
  });
  context.open(OFFER_A_ID);
  context.orchestrator.updateUserTextDraft("User text");
  const submission = context.orchestrator.submitUserText();
  context.open(OFFER_B_ID);
  deferred.resolve(createEnvelope(OfferPreparationConstants.PREPARE_STATUS.READY));

  await submission;

  assert.equal(context.state.selectedOfferId, OFFER_B_ID);
  assert.equal(context.state.preparation.offerId, OFFER_B_ID);
  assert.equal(context.state.appliedOffers.at(-1).id, OFFER_A_ID);
});

test("synchronous double prepare starts only one flow", async () => {
  const deferred = createDeferred();
  const context = createContext({
    async prepareOffer() {
      return deferred.promise;
    },
  });
  context.open(OFFER_A_ID);

  const first = context.orchestrator.prepare();
  const second = context.orchestrator.prepare();

  assert.equal(context.calls.prepare, 1);
  deferred.resolve(createEnvelope(OfferPreparationConstants.PREPARE_STATUS.READY));
  await Promise.all([first, second]);
});

test("latest same-offer preparation wins after reopening the offer", async () => {
  const firstDeferred = createDeferred();
  const secondDeferred = createDeferred();
  let call = 0;
  const context = createContext({
    async prepareOffer() {
      call += 1;
      return call === 1 ? firstDeferred.promise : secondDeferred.promise;
    },
  });
  context.open(OFFER_A_ID);
  const first = context.orchestrator.prepare();
  context.open(OFFER_A_ID);
  const second = context.orchestrator.prepare();
  secondDeferred.resolve(createEnvelope(OfferPreparationConstants.PREPARE_STATUS.NEEDS_USER_TEXT));
  await second;
  firstDeferred.resolve(createEnvelope(OfferPreparationConstants.PREPARE_STATUS.READY));
  await first;

  assert.equal(context.state.preparation.uiStatus,
    OfferPreparationConstants.UI_STATUS.NEEDS_USER_TEXT);
  assert.equal(context.state.appliedOffers.length, 2);
});
