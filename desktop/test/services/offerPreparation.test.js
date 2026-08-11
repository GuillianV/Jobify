import test from "node:test";
import assert from "node:assert/strict";
import {
  persistProviderContent,
  prepareOffer,
  submitUserContent,
} from "../../src/services/offerPreparation.js";
import { OfferPreparationConstants } from "../../src/constants/OfferPreparationConstants.js";

const OFFER_ID = 42;
const PROVIDED_AT = "2026-08-11T10:00:00.000Z";

/**
 * Build one structurally valid preparation envelope.
 * @param {object} [overrides] - Values replacing envelope defaults.
 * @returns {object} Preparation envelope.
 */
function createEnvelope(overrides = {}) {
  return {
    prepareStatus: OfferPreparationConstants.PREPARE_STATUS.READY,
    evaluation: { status: "SUFFICIENT" },
    offre: { id: OFFER_ID, description: "Automatic text" },
    userContent: null,
    providerAcquisition: null,
    ...overrides,
  };
}

/**
 * Build an injected fetch implementation and observable request record.
 * @param {unknown} payload - JSON payload to return.
 * @param {object} [responseOverrides] - Values replacing response defaults.
 * @returns {{request: Function, calls: object[]}} Request test context.
 */
function createRequest(payload, responseOverrides = {}) {
  const calls = [];
  return {
    calls,
    async request(url, options) {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return payload;
        },
        ...responseOverrides,
      };
    },
  };
}

test("prepareOffer posts to the persisted observation preparation endpoint", async () => {
  const envelope = createEnvelope();
  const context = createRequest(envelope);

  const result = await prepareOffer(OFFER_ID, context.request);

  assert.equal(result, envelope);
  assert.deepEqual(context.calls, [{
    url: "http://localhost:3001/api/offres/42/prepare",
    options: { method: "POST" },
  }]);
});

test("submitUserContent puts only text and returns the complete envelope", async () => {
  const envelope = createEnvelope({
    userContent: { text: "User text", providedAt: PROVIDED_AT },
  });
  const context = createRequest(envelope);

  const result = await submitUserContent(OFFER_ID, "User text", context.request);

  assert.equal(result, envelope);
  assert.equal(context.calls[0].options.method, "PUT");
  assert.equal(context.calls[0].url, "http://localhost:3001/api/offres/42/contenu-utilisateur");
  assert.deepEqual(JSON.parse(context.calls[0].options.body), { text: "User text" });
});

test("persistProviderContent patches only the server DETAIL fields", async () => {
  const envelope = createEnvelope();
  const context = createRequest(envelope);
  const detail = {
    description: "DETAIL",
    sourceUrl: "https://www.hellowork.com/fr-fr/emplois/123.html",
    ignored: "metadata",
  };

  const result = await persistProviderContent(OFFER_ID, detail, context.request);

  assert.equal(result, envelope);
  assert.equal(context.calls[0].options.method, "PATCH");
  assert.equal(context.calls[0].url, "http://localhost:3001/api/offres/42/contenu");
  assert.deepEqual(JSON.parse(context.calls[0].options.body), {
    description: "DETAIL",
    sourceUrl: detail.sourceUrl,
  });
});

test("preparation requests reject HTTP and invalid JSON failures", async () => {
  const nonOk = createRequest(createEnvelope(), { ok: false, status: 503 });
  const invalidJson = createRequest(createEnvelope(), {
    async json() {
      throw new SyntaxError("Invalid JSON");
    },
  });

  await assert.rejects(() => {
    return prepareOffer(OFFER_ID, nonOk.request);
  }, /HTTP 503/);
  await assert.rejects(() => {
    return prepareOffer(OFFER_ID, invalidJson.request);
  }, /Invalid JSON/);
});

test("preparation envelope rejects important structural contract violations", async () => {
  const providerAcquisition = {
    kind: OfferPreparationConstants.PROVIDER_ACQUISITION_KIND.HELLOWORK_DETAIL,
    source: OfferPreparationConstants.PROVIDER_SOURCE.HELLOWORK,
    url: "https://www.hellowork.com/fr-fr/emplois/123.html",
  };
  const invalidEnvelopes = [
    null,
    createEnvelope({ prepareStatus: "UNKNOWN" }),
    createEnvelope({ evaluation: null }),
    createEnvelope({ offre: { id: 0 } }),
    createEnvelope({ userContent: { text: "User text", providedAt: "invalid" } }),
    createEnvelope({ providerAcquisition: { ...providerAcquisition, source: "unknown" } }),
  ];

  for (const envelope of invalidEnvelopes) {
    const context = createRequest(envelope);
    await assert.rejects(() => {
      return prepareOffer(OFFER_ID, context.request);
    }, /Invalid preparation response/);
  }
});

test("preparation envelope accepts recognized provider acquisition instructions", async () => {
  const envelope = createEnvelope({
    prepareStatus: OfferPreparationConstants.PREPARE_STATUS.NEEDS_PROVIDER_ACQUISITION,
    providerAcquisition: {
      kind: OfferPreparationConstants.PROVIDER_ACQUISITION_KIND.HELLOWORK_DETAIL,
      source: OfferPreparationConstants.PROVIDER_SOURCE.HELLOWORK,
      url: "https://www.hellowork.com/fr-fr/emplois/123.html",
    },
  });
  const context = createRequest(envelope);

  assert.equal(await prepareOffer(OFFER_ID, context.request), envelope);
});
