import test from "node:test";
import assert from "node:assert/strict";
import { OfferAnalysisCacheIdentity } from "../../src/services/OfferAnalysisCacheIdentity.js";

const OFFER_ID = 42;
const OTHER_OFFER_ID = 43;
const CONFIGURED_MAX_OUTPUT_TOKENS = 4096;
const OTHER_MAX_OUTPUT_TOKENS = 2048;

/**
 * Build one complete deterministic identity input with optional overrides.
 * @param {object} [overrides] - Components replacing the stable defaults.
 * @returns {object} Cache identity input.
 */
function createComponents(overrides = {}) {
  return {
    offerId: OFFER_ID,
    contentFingerprint: "content-fingerprint",
    deterministicInputFingerprint: "input-fingerprint",
    policyVersion: "offer-analyzer-v5",
    schemaVersion: "offer-analysis-schema-v1",
    llmProvider: "GROQ",
    model: "model-a",
    configuredMaxOutputTokens: CONFIGURED_MAX_OUTPUT_TOKENS,
    ...overrides,
  };
}

test("identical components produce the same immutable cache identity", () => {
  const first = OfferAnalysisCacheIdentity.build(createComponents());
  const second = OfferAnalysisCacheIdentity.build(createComponents());

  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.match(first.cacheKey, /^[a-f0-9]{64}$/u);
});

test("every pre-provider identity component changes the cache key", () => {
  const original = OfferAnalysisCacheIdentity.build(createComponents());
  const changes = [
    { offerId: OTHER_OFFER_ID },
    { contentFingerprint: "other-content" },
    { deterministicInputFingerprint: "other-input" },
    { policyVersion: "other-policy" },
    { schemaVersion: "other-schema" },
    { llmProvider: "OTHER_PROVIDER" },
    { model: "model-b" },
    { configuredMaxOutputTokens: OTHER_MAX_OUTPUT_TOKENS },
  ];

  for (const change of changes) {
    const changed = OfferAnalysisCacheIdentity.build(createComponents(change));
    assert.notEqual(changed.cacheKey, original.cacheKey);
  }
});

test("caller property order does not affect canonical cache serialization", () => {
  const components = createComponents();
  const reversed = Object.fromEntries(Object.entries(components).reverse());

  assert.equal(
    OfferAnalysisCacheIdentity.build(components).cacheKey,
    OfferAnalysisCacheIdentity.build(reversed).cacheKey,
  );
});

test("post-provider provenance is excluded from the cache identity", () => {
  const withFirstProvenance = OfferAnalysisCacheIdentity.build({
    ...createComponents(),
    effectiveMaxOutputTokens: CONFIGURED_MAX_OUTPUT_TOKENS,
    analyzedAt: "2026-08-13T10:00:00.000Z",
  });
  const withOtherProvenance = OfferAnalysisCacheIdentity.build({
    ...createComponents(),
    effectiveMaxOutputTokens: OTHER_MAX_OUTPUT_TOKENS,
    analyzedAt: "2026-08-13T11:00:00.000Z",
  });

  assert.equal(withFirstProvenance.cacheKey, withOtherProvenance.cacheKey);
  assert.equal(Object.hasOwn(withFirstProvenance, "effectiveMaxOutputTokens"), false);
  assert.equal(Object.hasOwn(withFirstProvenance, "analyzedAt"), false);
});

test("invalid essential identity inputs are rejected", () => {
  const invalidComponents = [
    null,
    createComponents({ offerId: 0 }),
    createComponents({ contentFingerprint: "" }),
    createComponents({ deterministicInputFingerprint: "   " }),
    createComponents({ policyVersion: null }),
    createComponents({ schemaVersion: "" }),
    createComponents({ llmProvider: " " }),
    createComponents({ model: "" }),
    createComponents({ configuredMaxOutputTokens: 0 }),
  ];

  for (const components of invalidComponents) {
    assert.throws(() => {
      return OfferAnalysisCacheIdentity.build(components);
    }, TypeError);
  }
});
