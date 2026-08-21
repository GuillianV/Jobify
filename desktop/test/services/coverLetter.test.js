import test from "node:test";
import assert from "node:assert/strict";
import { generateCoverLetter, validateCoverLetter } from "../../src/services/coverLetter.js";

const OFFER_ID = 42;
const GENERATION_TOKEN = " opaque-token ";

/**
 * Build one atomic ApplicationBrief result fixture.
 * @returns {object} Result fixture.
 */
function createApplicationBriefResult() {
  return {
    brief: { schemaVersion: "application-brief-schema-v1", private: true },
    generationToken: GENERATION_TOKEN,
  };
}

/**
 * Build one valid CoverLetter fixture.
 * @returns {object} CoverLetter fixture.
 */
function createCoverLetter() {
  return {
    schemaVersion: "cover-letter-schema-v1",
    letter: "Madame, Monsieur,",
    usedClaimIndexes: [0, 2],
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

test("client posts exactly brief and opaque token to the exact endpoint", async () => {
  const applicationBriefResult = createApplicationBriefResult();
  const coverLetter = createCoverLetter();
  const signal = new globalThis.AbortController().signal;
  let captured = null;
  const result = await generateCoverLetter(
    OFFER_ID,
    applicationBriefResult,
    async (url, options) => {
      captured = { url, options };
      return createResponse({ ok: true, status: 200, payload: { coverLetter, ignored: true } });
    },
    signal,
  );
  assert.equal(captured.url, "http://localhost:3001/api/offres/42/cover-letter");
  assert.equal(captured.options.method, "POST");
  assert.deepEqual(captured.options.headers, { "Content-Type": "application/json" });
  assert.equal(captured.options.signal, signal);
  const body = JSON.parse(captured.options.body);
  assert.deepEqual(Object.keys(body), ["brief", "generationToken"]);
  assert.deepEqual(body.brief, applicationBriefResult.brief);
  assert.equal(body.generationToken, GENERATION_TOKEN);
  assert.deepEqual(result, coverLetter);
  assert.notEqual(result.usedClaimIndexes, coverLetter.usedClaimIndexes);
});

test("client rejects invalid offer and atomic result before requesting", async () => {
  const invalidInputs = [
    [0, createApplicationBriefResult()],
    [OFFER_ID, null],
    [OFFER_ID, { brief: null, generationToken: GENERATION_TOKEN }],
    [OFFER_ID, { brief: {}, generationToken: "" }],
    [OFFER_ID, { brief: {}, generationToken: null }],
  ];
  for (const [offerId, result] of invalidInputs) {
    let called = false;
    await assert.rejects(generateCoverLetter(offerId, result, async () => {
      called = true;
    }), TypeError);
    assert.equal(called, false);
  }
});

test("client rejects malformed envelopes and cover letter fields", async () => {
  const valid = createCoverLetter();
  const invalidPayloads = [
    null,
    {},
    { coverLetter: [] },
    { coverLetter: { ...valid, schemaVersion: "other" } },
    { coverLetter: { ...valid, letter: "" } },
    { coverLetter: { ...valid, letter: null } },
    { coverLetter: { ...valid, usedClaimIndexes: null } },
    { coverLetter: { ...valid, usedClaimIndexes: [-1] } },
    { coverLetter: { ...valid, usedClaimIndexes: [1.5] } },
    { coverLetter: { ...valid, usedClaimIndexes: [Number.MAX_SAFE_INTEGER + 1] } },
  ];
  for (const payload of invalidPayloads) {
    await assert.rejects(generateCoverLetter(
      OFFER_ID,
      createApplicationBriefResult(),
      async () => {
        return createResponse({ ok: true, status: 200, payload });
      },
    ), TypeError);
  }
});

test("validated response contains only whitelisted detached fields", () => {
  const coverLetter = { ...createCoverLetter(), private: true };
  const result = validateCoverLetter(coverLetter);
  assert.deepEqual(result, createCoverLetter());
  assert.equal(Object.hasOwn(result, "private"), false);
  result.usedClaimIndexes.push(3);
  assert.deepEqual(coverLetter.usedClaimIndexes, [0, 2]);
});

test("HTTP errors retain only public status and code including refresh required", async () => {
  for (const [status, code] of [
    [409, "APPLICATION_BRIEF_REFRESH_REQUIRED"],
    [503, "COVER_LETTER_UNAVAILABLE"],
  ]) {
    const error = await generateCoverLetter(
      OFFER_ID,
      createApplicationBriefResult(),
      async () => {
        return createResponse({
          ok: false,
          status,
          payload: { code, message: "private", raw: { secret: true } },
        });
      },
    ).catch((caught) => {
      return caught;
    });
    assert.equal(error.name, "CoverLetterHttpError");
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    assert.equal(Object.hasOwn(error, "raw"), false);
  }
});
