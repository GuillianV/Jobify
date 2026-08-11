import test from "node:test";
import assert from "node:assert/strict";
import {
  acquireProviderContent,
  applyEnrichedOffer,
  replaceOfferById,
} from "../../src/services/offerContentAcquisition.js";
import { OfferPreparationConstants } from "../../src/constants/OfferPreparationConstants.js";

const OFFER_ID = 42;

/**
 * Create state setters that evaluate React-style functional updates immediately.
 * @param {object[]} initialOffers - Initial list state.
 * @param {object|null} initialSelection - Initial selected offer.
 * @returns {object} Mutable state and matching setter functions.
 */
function createReactState(initialOffers, initialSelection) {
  const state = {
    offers: initialOffers,
    selectedOffer: initialSelection,
  };
  return {
    state,
    setOffers(update) {
      state.offers = update(state.offers);
    },
    setSelectedOffer(update) {
      state.selectedOffer = update(state.selectedOffer);
    },
  };
}

/**
 * Build one HelloWork API offer for renderer acquisition tests.
 * @param {object} [overrides] - Values replacing defaults.
 * @returns {object} API offer.
 */
function createOffer(overrides = {}) {
  return {
    id: OFFER_ID,
    source: "hellowork",
    sourceId: "hello-1",
    description: null,
    applyUrl: "https://www.hellowork.com/fr-fr/emplois/123.html",
    ...overrides,
  };
}

test("replaceOfferById changes only the matching local observation", () => {
  const enriched = createOffer({ description: "DETAIL" });
  const unrelated = createOffer({ id: 43, sourceId: "hello-2" });
  const replaced = replaceOfferById([createOffer(), unrelated], enriched);

  assert.equal(replaced[0], enriched);
  assert.equal(replaced[1], unrelated);
});

test("provider acquisition preserves the three discriminated IPC results", async () => {
  const instruction = {
    kind: OfferPreparationConstants.PROVIDER_ACQUISITION_KIND.HELLOWORK_DETAIL,
    source: OfferPreparationConstants.PROVIDER_SOURCE.HELLOWORK,
    url: createOffer().applyUrl,
  };
  const detail = { description: "DETAIL", sourceUrl: instruction.url };

  const acquired = await acquireProviderContent(instruction, async () => {
    return { status: OfferPreparationConstants.IPC_STATUS.ACQUIRED, detail };
  });
  const notFound = await acquireProviderContent(instruction, async () => {
    return { status: OfferPreparationConstants.IPC_STATUS.NOT_FOUND };
  });
  const failed = await acquireProviderContent(instruction, async () => {
    return { status: OfferPreparationConstants.IPC_STATUS.FAILED };
  });

  assert.deepEqual(acquired, {
    status: OfferPreparationConstants.IPC_STATUS.ACQUIRED,
    detail,
  });
  assert.deepEqual(notFound, { status: OfferPreparationConstants.IPC_STATUS.NOT_FOUND });
  assert.deepEqual(failed, { status: OfferPreparationConstants.IPC_STATUS.FAILED });
});

test("provider acquisition rejects invalid instructions and bridge failures safely", async () => {
  let bridgeCalls = 0;
  const invalid = await acquireProviderContent({
    kind: "UNKNOWN",
    source: OfferPreparationConstants.PROVIDER_SOURCE.HELLOWORK,
    url: createOffer().applyUrl,
  }, async () => {
    bridgeCalls += 1;
    return null;
  });
  const instruction = {
    kind: OfferPreparationConstants.PROVIDER_ACQUISITION_KIND.HELLOWORK_DETAIL,
    source: OfferPreparationConstants.PROVIDER_SOURCE.HELLOWORK,
    url: createOffer().applyUrl,
  };
  const thrown = await acquireProviderContent(instruction, async () => {
    throw new Error("Internal Electron failure");
  });

  assert.equal(bridgeCalls, 0);
  assert.deepEqual(invalid, { status: OfferPreparationConstants.IPC_STATUS.FAILED });
  assert.deepEqual(thrown, { status: OfferPreparationConstants.IPC_STATUS.FAILED });
});

test("completed acquisition updates the list without reopening a closed modal", () => {
  const offer = createOffer();
  const enriched = createOffer({ description: "DETAIL" });
  const context = createReactState([offer], null);

  applyEnrichedOffer(enriched, context.setOffers, context.setSelectedOffer);

  assert.equal(context.state.offers[0], enriched);
  assert.equal(context.state.selectedOffer, null);
});

test("completed acquisition A updates the list without replacing selected offer B", () => {
  const offerA = createOffer();
  const offerB = createOffer({ id: 43, sourceId: "hello-2" });
  const enrichedA = createOffer({ description: "DETAIL A" });
  const context = createReactState([offerA, offerB], offerB);

  applyEnrichedOffer(enrichedA, context.setOffers, context.setSelectedOffer);

  assert.equal(context.state.offers[0], enrichedA);
  assert.equal(context.state.offers[1], offerB);
  assert.equal(context.state.selectedOffer, offerB);
});
