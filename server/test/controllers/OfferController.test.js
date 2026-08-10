import test from "node:test";
import assert from "node:assert/strict";
import { OfferController } from "../../src/controllers/OfferController.js";
import { HttpStatus } from "../../src/constants/HttpStatus.js";

const OFFER_ID = 42;
const MAXIMUM_SAFE_ID = "9007199254740991";
const UNSAFE_ID = "9007199254740992";

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

test("content endpoint returns a backward-compatible preparation envelope", () => {
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
    {
      prepare() {
        return {
          prepareStatus: "READY",
          evaluation: { status: "SUFFICIENT" },
          offer: enriched,
          userContent: null,
          providerAcquisition: null,
        };
      },
    },
  );

  controller.enrichOfferContent({ params: { id: "42" }, body: { description: "DETAIL" } }, {});

  assert.deepEqual(received, { id: 42, body: { description: "DETAIL" } });
  assert.deepEqual(rendered, {
    prepareStatus: "READY",
    evaluation: { status: "SUFFICIENT" },
    offre: { id: 42, source: "hellowork", description: "DETAIL" },
    userContent: null,
    providerAcquisition: null,
  });
});

test("prepare endpoint delegates only the parsed SQLite id and projects the envelope", () => {
  let receivedId = null;
  let rendered = null;
  const offer = {
    id: 42,
    toJson() {
      return { source: "adzuna", description: "Provider text" };
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
    null,
    {
      prepare(id) {
        receivedId = id;
        return {
          prepareStatus: "NEEDS_USER_TEXT",
          evaluation: { status: "UNDETERMINED" },
          offer,
          userContent: null,
          providerAcquisition: null,
        };
      },
    },
  );

  controller.prepareOffer({ params: { id: "42" }, body: { source: "spoofed" } }, {});

  assert.equal(receivedId, OFFER_ID);
  assert.equal(rendered.offre.id, OFFER_ID);
  assert.equal(rendered.prepareStatus, "NEEDS_USER_TEXT");
});

test("user-content endpoint forwards only text and ignores spoofed metadata", () => {
  let received = null;
  let rendered = null;
  const offer = {
    id: 42,
    toJson() {
      return { source: "hellowork", description: "Provider text" };
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
    null,
    {
      replaceUserText(id, text) {
        received = { id, text };
        return {
          prepareStatus: "READY",
          evaluation: { status: "SUFFICIENT" },
          offer,
          userContent: { text, providedAt: "server-time" },
          providerAcquisition: null,
        };
      },
    },
  );
  const body = {
    text: "User text",
    providedAt: "client-time",
    source: "adzuna",
    completeness: "spoofed",
    offerContent: { forbidden: true },
  };

  controller.replaceUserContent({ params: { id: "42" }, body }, {});

  assert.deepEqual(received, { id: 42, text: "User text" });
  assert.deepEqual(rendered.userContent, { text: "User text", providedAt: "server-time" });
  assert.equal(rendered.offre.source, "hellowork");
});

test("HTTP offer id parser accepts only canonical positive safe decimals", () => {
  const controller = new OfferController();
  const acceptedIds = ["1", "12", "123456", MAXIMUM_SAFE_ID];
  const rejectedIds = [
    "0",
    "-1",
    "12.5",
    "12abc",
    "1e2",
    "12.0",
    "+12",
    " 12 ",
    "012",
    UNSAFE_ID,
  ];

  for (const rawId of acceptedIds) {
    assert.equal(controller.parseOfferId(rawId), Number(rawId));
  }
  for (const rawId of rejectedIds) {
    assert.throws(() => {
      return controller.parseOfferId(rawId);
    }, (error) => {
      return error.statusCode === HttpStatus.BAD_REQUEST;
    });
  }
});

test("all three preparation endpoints reject noncanonical ids before delegation", () => {
  const renderedStatuses = [];
  let delegationCount = 0;
  const controller = new OfferController(
    null,
    null,
    {
      renderError(response, statusCode) {
        renderedStatuses.push(statusCode);
      },
    },
    {
      enrichHelloWorkDetail() {
        delegationCount += 1;
      },
    },
    {
      prepare() {
        delegationCount += 1;
      },
      replaceUserText() {
        delegationCount += 1;
      },
    },
  );
  const request = { params: { id: "1e2" }, body: { text: "User text" } };

  controller.enrichOfferContent(request, {});
  controller.prepareOffer(request, {});
  controller.replaceUserContent(request, {});

  assert.equal(delegationCount, 0);
  assert.deepEqual(renderedStatuses, [
    HttpStatus.BAD_REQUEST,
    HttpStatus.BAD_REQUEST,
    HttpStatus.BAD_REQUEST,
  ]);
});

test("prepare envelope keeps automatic description and user content separate", () => {
  let rendered = null;
  const offer = {
    id: OFFER_ID,
    toJson() {
      return { source: "hellowork", description: "Automatic text" };
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
    null,
    {
      prepare() {
        return {
          prepareStatus: "READY",
          evaluation: { status: "SUFFICIENT" },
          offer,
          userContent: { text: "User text", providedAt: "server-time" },
          providerAcquisition: null,
        };
      },
    },
  );

  controller.prepareOffer({ params: { id: String(OFFER_ID) } }, {});

  assert.equal(rendered.offre.description, "Automatic text");
  assert.equal(rendered.userContent.text, "User text");
});
