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

test("search API projection exposes persisted id without changing domain JSON", async () => {
  let rendered = null;
  const offer = {
    id: 42,
    toJson() {
      return { source: "hellowork", description: null };
    },
  };
  const controller = new OfferController(
    {
      async search() {
        return [offer];
      },
    },
    {
      async resolve() {
        return null;
      },
    },
    {
      renderSuccess(response, payload) {
        rendered = payload;
      },
    },
    null,
  );

  await controller.searchOffers({ query: {}, body: {} }, {});

  assert.deepEqual(rendered.offres[0], { id: 42, source: "hellowork", description: null });
  assert.equal(offer.toJson().id, undefined);
});

test("content endpoint returns the enriched API projection", () => {
  let rendered = null;
  let received = null;
  const enriched = {
    id: 42,
    toJson() {
      return { source: "hellowork", description: "DETAIL" };
    },
  };
  const controller = new OfferController(
    null,
    null,
    {
      renderSuccess(response, payload) {
        rendered = payload;
      },
    },
    {
      enrichHelloWorkDetail(id, body) {
        received = { id, body };
        return enriched;
      },
    },
  );

  controller.enrichOfferContent({ params: { id: "42" }, body: { description: "DETAIL" } }, {});

  assert.deepEqual(received, { id: 42, body: { description: "DETAIL" } });
  assert.deepEqual(rendered, {
    offre: { id: 42, source: "hellowork", description: "DETAIL" },
  });
});
