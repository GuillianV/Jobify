import test from "node:test";
import assert from "node:assert/strict";
import {
  generateApplicationBrief,
  validateApplicationBrief,
} from "../../src/services/applicationBrief.js";

const OFFER_ID = 42;
const GENERATION_TOKEN = "opaque-token";

/**
 * Build one minimally renderable brief.
 * @returns {object} Brief fixture.
 */
function createBrief() {
  return {
    schemaVersion: "application-brief-schema-v1",
    inputIdentity: { private: true },
    requirementMatches: [],
    evidenceFacts: [],
    emphasis: [],
    supportedClaims: [{ claimType: "EXPERIENCE_FACT" }],
    cautions: [],
  };
}

/**
 * Build one fetch-like response.
 * @param {object} details - Response details.
 * @returns {object} Fetch response.
 */
function createResponse({ ok, status, payload }) {
  return {
    ok,
    status,
    async json() {
      return globalThis.structuredClone(payload);
    },
  };
}

test("client posts to the exact offer endpoint without a business body", async () => {
  const brief = createBrief();
  const signal = new globalThis.AbortController().signal;
  let captured = null;
  const result = await generateApplicationBrief(OFFER_ID, async (url, options) => {
    captured = { url, options };
    return createResponse({
      ok: true,
      status: 200,
      payload: { brief, generationToken: GENERATION_TOKEN },
    });
  }, signal);

  assert.equal(captured.url, "http://localhost:3001/api/offres/42/application-brief");
  assert.equal(captured.options.method, "POST");
  assert.equal(Object.hasOwn(captured.options, "body"), false);
  assert.equal(captured.options.signal, signal);
  assert.deepEqual(result, { brief, generationToken: GENERATION_TOKEN });
  assert.notEqual(result.brief, brief);
  assert.equal(result.generationToken, GENERATION_TOKEN);
  result.brief.requirementMatches.push({ external: true });
  assert.deepEqual(brief.requirementMatches, []);
});

test("client rejects invalid offer identifiers before requesting", async () => {
  for (const offerId of [0, -1, Number.MAX_SAFE_INTEGER + 1, "42", null]) {
    let called = false;
    await assert.rejects(generateApplicationBrief(offerId, async () => {
      called = true;
    }), TypeError);
    assert.equal(called, false);
  }
});

test("client retains only public status and code on non-success responses", async () => {
  const error = await generateApplicationBrief(OFFER_ID, async () => {
    return createResponse({
      ok: false,
      status: 503,
      payload: { code: "APPLICATION_BRIEF_UNAVAILABLE", reason: "private", raw: {} },
    });
  }).catch((caught) => {
    return caught;
  });
  assert.equal(error.name, "ApplicationBriefHttpError");
  assert.equal(error.status, 503);
  assert.equal(error.code, "APPLICATION_BRIEF_UNAVAILABLE");
  assert.equal(Object.hasOwn(error, "reason"), false);
  assert.equal(Object.hasOwn(error, "raw"), false);
});

test("client fails closed on malformed success envelopes and render structures", async () => {
  const missingEvidenceReference = {
    ...createBrief(),
    requirementMatches: [{
      state: "SUPPORTED",
      supportedFacets: [{
        text: "React",
        evidenceRefs: [{ kind: "SKILL", itemId: "skill-1", field: "name" }],
      }],
      notEvidencedFacets: [],
    }],
  };
  const invalidPayloads = [
    null,
    {},
    { brief: createBrief() },
    { brief: createBrief(), generationToken: "" },
    { brief: [], generationToken: GENERATION_TOKEN },
    { brief: { requirementMatches: [] }, generationToken: GENERATION_TOKEN },
    {
      brief: { ...createBrief(), requirementMatches: [{ state: "UNKNOWN" }] },
      generationToken: GENERATION_TOKEN,
    },
    {
      brief: { ...createBrief(), cautions: [{ kind: "UNKNOWN", evidenceRefs: [] }] },
      generationToken: GENERATION_TOKEN,
    },
    { brief: missingEvidenceReference, generationToken: GENERATION_TOKEN },
  ];
  for (const payload of invalidPayloads) {
    await assert.rejects(generateApplicationBrief(OFFER_ID, async () => {
      return createResponse({ ok: true, status: 200, payload });
    }), TypeError);
  }
});

test("client rejects duplicate canonical evidence facts without choosing a value", async () => {
  const reference = { kind: "SKILL", itemId: "skill_1", field: "value" };
  for (const duplicateValue of ["Vue", "React"]) {
    const brief = {
      ...createBrief(),
      evidenceFacts: [
        { ref: reference, value: "React" },
        { ref: reference, value: duplicateValue },
      ],
    };
    await assert.rejects(generateApplicationBrief(OFFER_ID, async () => {
      return createResponse({
        ok: true,
        status: 200,
        payload: { brief, generationToken: GENERATION_TOKEN },
      });
    }), TypeError);
  }
});

test("brief validation preserves supported claims and invisible metadata", () => {
  const brief = createBrief();
  assert.deepEqual(validateApplicationBrief(brief), brief);
});
