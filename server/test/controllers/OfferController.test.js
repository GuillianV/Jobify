import test from "node:test";
import assert from "node:assert/strict";
import { OfferController } from "../../src/controllers/OfferController.js";
import { HttpStatus } from "../../src/constants/HttpStatus.js";
import { OfferPreparationConstants } from "../../src/constants/OfferPreparationConstants.js";
import { OfferAnalysisServiceError } from "../../src/services/OfferAnalysisServiceError.js";
import { OfferAnalyzerError } from "../../src/services/OfferAnalyzerError.js";
import { OfferPreparationError } from "../../src/services/OfferPreparationError.js";

const OFFER_ID = 42;
const MAXIMUM_SAFE_ID = "9007199254740991";
const UNSAFE_ID = "9007199254740992";

/**
 * Build a controller harness for the analysis endpoint only.
 * @param {object} behavior - Fake runtime behavior.
 * @returns {object} Controller and captured rendering state.
 */
function createAnalysisHarness(behavior) {
  const state = { calls: 0, success: null, error: null };
  const offerAnalysisService = {
    async analyze(id) {
      state.calls += 1;
      assert.equal(id, OFFER_ID);
      if (behavior.error) {
        throw behavior.error;
      }
      return behavior.result;
    },
  };
  const view = {
    renderSuccess(response, payload) {
      state.success = payload;
    },
    renderError(response, statusCode, message, publicMetadata) {
      state.error = { statusCode, message, publicMetadata };
    },
  };
  return {
    controller: new OfferController(null, null, view, null, null, offerAnalysisService),
    state,
  };
}

/**
 * Build one complete runtime result containing intentionally private metadata.
 * @param {boolean} cacheHit - Runtime cache result.
 * @returns {object} Runtime result.
 */
function createRuntimeResult(cacheHit) {
  return {
    analysis: {
      toJson() {
        return { activities: [{ value: "Public analysis" }] };
      },
    },
    cacheHit,
    analyzer: {
      policyVersion: "offer-analyzer-v5",
      schemaVersion: "offer-analysis-schema-v1",
      provider: "GROQ",
      model: "private-model",
      configuredMaxOutputTokens: 4096,
      effectiveMaxOutputTokens: 2048,
    },
    analyzedAt: "2026-08-13T10:00:00.000Z",
    contentFingerprint: "private-fingerprint",
    cacheKey: "private-cache-key",
  };
}

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

test("analysis endpoint whitelists generated and cached success payloads", async () => {
  for (const cacheHit of [false, true]) {
    const harness = createAnalysisHarness({ result: createRuntimeResult(cacheHit) });
    await harness.controller.analyseOffer({ params: { id: String(OFFER_ID) } }, {});

    assert.equal(harness.state.calls, 1);
    assert.deepEqual(harness.state.success, {
      analyse: { activities: [{ value: "Public analysis" }] },
      cacheHit,
      analyzer: {
        policyVersion: "offer-analyzer-v5",
        schemaVersion: "offer-analysis-schema-v1",
      },
      analyzedAt: "2026-08-13T10:00:00.000Z",
    });
    const serialized = JSON.stringify(harness.state.success);
    for (const privateValue of [
      "GROQ",
      "private-model",
      "private-fingerprint",
      "private-cache-key",
      "configuredMaxOutputTokens",
      "effectiveMaxOutputTokens",
    ]) {
      assert.equal(serialized.includes(privateValue), false);
    }
  }
});

test("analysis endpoint rejects invalid ids before runtime delegation", async () => {
  const harness = createAnalysisHarness({ result: createRuntimeResult(false) });
  await harness.controller.analyseOffer({ params: { id: "1e2-sensitive" } }, {});
  assert.equal(harness.state.calls, 0);
  assert.deepEqual(harness.state.error, {
    statusCode: HttpStatus.BAD_REQUEST,
    message: "Invalid offer id",
    publicMetadata: { code: "INVALID_OFFER_ID" },
  });
  assert.equal(JSON.stringify(harness.state.error).includes("1e2-sensitive"), false);
});

test("analysis endpoint maps preparation not-found without reusing its message", async () => {
  const sensitive = "sensitive preparation details";
  const harness = createAnalysisHarness({
    error: new OfferPreparationError(sensitive, HttpStatus.NOT_FOUND),
  });
  await harness.controller.analyseOffer({ params: { id: String(OFFER_ID) } }, {});
  assert.deepEqual(harness.state.error, {
    statusCode: HttpStatus.NOT_FOUND,
    message: "Offer not found",
    publicMetadata: { code: "OFFER_NOT_FOUND" },
  });
  assert.equal(JSON.stringify(harness.state.error).includes(sensitive), false);
});

test("analysis endpoint exposes only whitelisted non-READY statuses", async () => {
  for (const prepareStatus of [
    OfferPreparationConstants.STATUS.NEEDS_PROVIDER_ACQUISITION,
    OfferPreparationConstants.STATUS.NEEDS_USER_TEXT,
  ]) {
    const error = new OfferAnalysisServiceError(
      OfferAnalysisServiceError.CODE.OFFER_NOT_READY,
      { prepareStatus, forbidden: "sensitive" },
    );
    const harness = createAnalysisHarness({ error });
    await harness.controller.analyseOffer({ params: { id: String(OFFER_ID) } }, {});
    assert.deepEqual(harness.state.error, {
      statusCode: HttpStatus.CONFLICT,
      message: "Offer is not ready",
      publicMetadata: {
        code: OfferAnalysisServiceError.CODE.OFFER_NOT_READY,
        prepareStatus,
      },
    });
    assert.equal(JSON.stringify(harness.state.error).includes("forbidden"), false);
  }

  const malformed = new OfferAnalysisServiceError(
    OfferAnalysisServiceError.CODE.OFFER_NOT_READY,
    { prepareStatus: "UNKNOWN", forbidden: "sensitive" },
  );
  const harness = createAnalysisHarness({ error: malformed });
  await harness.controller.analyseOffer({ params: { id: String(OFFER_ID) } }, {});
  assert.deepEqual(harness.state.error.publicMetadata, {
    code: OfferAnalysisServiceError.CODE.OFFER_NOT_READY,
  });
});

test("analysis endpoint maps every closed Analyzer transport code", async () => {
  const cases = [
    [OfferAnalyzerError.CODE.ANALYZER_INPUT_TOO_LARGE,
      HttpStatus.UNPROCESSABLE_ENTITY, "Offer content is too large to analyze"],
    [OfferAnalyzerError.CODE.ANALYZER_UNAVAILABLE,
      HttpStatus.SERVICE_UNAVAILABLE, "Offer analysis service is unavailable"],
    [OfferAnalyzerError.CODE.ANALYZER_TIMEOUT,
      HttpStatus.SERVICE_UNAVAILABLE, "Offer analysis service timed out"],
    [OfferAnalyzerError.CODE.ANALYZER_RATE_LIMITED,
      HttpStatus.SERVICE_UNAVAILABLE, "Offer analysis service is temporarily unavailable"],
    [OfferAnalyzerError.CODE.ANALYZER_PROVIDER_ERROR,
      HttpStatus.BAD_GATEWAY, "Offer analysis provider failed"],
    [OfferAnalyzerError.CODE.ANALYZER_PROVIDER_TOKEN_BUDGET,
      HttpStatus.BAD_GATEWAY, "Offer analysis provider rejected the token budget"],
  ];
  for (const [code, statusCode, message] of cases) {
    const error = new OfferAnalyzerError(code, { forbidden: 123 }, new Error("cause"));
    const harness = createAnalysisHarness({ error });
    await harness.controller.analyseOffer({ params: { id: String(OFFER_ID) } }, {});
    assert.deepEqual(harness.state.error, {
      statusCode,
      message,
      publicMetadata: { code },
    });
    assert.equal(JSON.stringify(harness.state.error).includes("forbidden"), false);
  }
});

test("analysis invalid output keeps validation diagnostics internal", async () => {
  const error = new OfferAnalyzerError(
    OfferAnalyzerError.CODE.ANALYZER_INVALID_OUTPUT,
    { validationCode: "EVIDENCE", validationSubcode: "PRIVATE_SUBCODE" },
    new Error("raw provider output"),
  );
  const harness = createAnalysisHarness({ error });
  await harness.controller.analyseOffer({ params: { id: String(OFFER_ID) } }, {});
  assert.deepEqual(harness.state.error, {
    statusCode: HttpStatus.BAD_GATEWAY,
    message: "Offer analysis provider returned an invalid response",
    publicMetadata: { code: OfferAnalyzerError.CODE.ANALYZER_INVALID_OUTPUT },
  });
  const serialized = JSON.stringify(harness.state.error);
  assert.equal(serialized.includes("validationCode"), false);
  assert.equal(serialized.includes("PRIVATE_SUBCODE"), false);
  assert.equal(serialized.includes("raw provider output"), false);
});

test("analysis endpoint sanitizes persistence and unexpected failures", async () => {
  const persistence = new OfferAnalysisServiceError(
    OfferAnalysisServiceError.CODE.CACHE_PERSISTENCE_ERROR,
    { cacheKey: "private" },
    new Error("SQL sensitive"),
  );
  const persistenceHarness = createAnalysisHarness({ error: persistence });
  await persistenceHarness.controller.analyseOffer(
    { params: { id: String(OFFER_ID) } },
    {},
  );
  assert.deepEqual(persistenceHarness.state.error, {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    message: "Internal server error",
    publicMetadata: { code: OfferAnalysisServiceError.CODE.CACHE_PERSISTENCE_ERROR },
  });

  const unexpectedHarness = createAnalysisHarness({
    error: new Error("sensitive internal message"),
  });
  await unexpectedHarness.controller.analyseOffer(
    { params: { id: String(OFFER_ID) } },
    {},
  );
  assert.deepEqual(unexpectedHarness.state.error, {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    message: "Internal server error",
    publicMetadata: { code: "INTERNAL_SERVER_ERROR" },
  });
  const serialized = JSON.stringify({
    persistence: persistenceHarness.state.error,
    unexpected: unexpectedHarness.state.error,
  });
  for (const forbidden of ["SQL", "cacheKey", "sensitive internal message", "stack"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("unknown Analyzer codes use a safe generic upstream failure", async () => {
  const harness = createAnalysisHarness({
    error: new OfferAnalyzerError("UNKNOWN_ANALYZER_CODE", {}, new Error("sensitive")),
  });
  await harness.controller.analyseOffer({ params: { id: String(OFFER_ID) } }, {});
  assert.deepEqual(harness.state.error, {
    statusCode: HttpStatus.BAD_GATEWAY,
    message: "Offer analysis provider failed",
    publicMetadata: { code: OfferAnalyzerError.CODE.ANALYZER_PROVIDER_ERROR },
  });
});
