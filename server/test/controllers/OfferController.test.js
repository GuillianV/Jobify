import test from "node:test";
import assert from "node:assert/strict";
import { OfferController } from "../../src/controllers/OfferController.js";

test("search controller delegates persistence to the search service", async () => {
  let searchCalls = 0;
  let rendered = null;
  const offerSearchService = {
    async search() {
      searchCalls += 1;
      return [];
    },
  };
  const communeResolver = {
    async resolve() {
      throw new Error("Location resolution was not expected");
    },
  };
  const view = {
    renderSuccess(response, payload) {
      rendered = payload;
    },
    renderError() {
      throw new Error("Error rendering was not expected");
    },
  };
  const controller = new OfferController(offerSearchService, communeResolver, view);

  await controller.searchOffers({ query: {}, body: {} }, {});

  assert.equal(searchCalls, 1);
  assert.equal(controller.offerRepository, undefined);
  assert.deepEqual(rendered, { count: 0, offres: [] });
});
