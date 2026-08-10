import test from "node:test";
import assert from "node:assert/strict";
import {
  acquireOfferDetail,
  applyEnrichedOffer,
  replaceOfferById,
  shouldAcquireOfferDetail,
} from "../../src/services/offerContentAcquisition.js";

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

test("HelloWork offer without description acquires and persists DETAIL", async () => {
  const offer = createOffer();
  let ipcCalls = 0;
  let persisted = null;
  const enriched = await acquireOfferDetail(
    offer,
    async () => {
      ipcCalls += 1;
      return { description: "DETAIL", sourceUrl: offer.applyUrl };
    },
    async (id, detail) => {
      persisted = { id, detail };
      return { ...offer, description: detail.description };
    },
  );

  assert.equal(ipcCalls, 1);
  assert.equal(persisted.id, OFFER_ID);
  assert.equal(enriched.description, "DETAIL");
});

test("enriched offers skip IPC and replace only their matching local observation", () => {
  const enriched = createOffer({ description: "DETAIL" });
  const unrelated = createOffer({ id: 43, sourceId: "hello-2" });
  const replaced = replaceOfferById([createOffer(), unrelated], enriched);

  assert.equal(shouldAcquireOfferDetail(enriched, async () => {}), false);
  assert.equal(replaced[0], enriched);
  assert.equal(replaced[1], unrelated);
});

test("failed or absent DETAIL leaves the SEARCH observation unchanged", async () => {
  const offer = createOffer();
  const absent = await acquireOfferDetail(offer, async () => {
    return null;
  }, async () => {
    throw new Error("Persistence must not run");
  });

  assert.equal(absent, null);
  assert.deepEqual(replaceOfferById([offer], offer), [offer]);
  await assert.rejects(() => {
    return acquireOfferDetail(offer, async () => {
      throw new Error("DETAIL failed");
    }, async () => {
      throw new Error("Persistence must not run");
    });
  }, /DETAIL failed/);
  assert.equal(offer.description, null);
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
