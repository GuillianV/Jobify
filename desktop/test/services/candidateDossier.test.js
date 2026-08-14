import test from "node:test";
import assert from "node:assert/strict";
import { CandidateDossierConstants } from "../../src/constants/CandidateDossierConstants.js";
import {
  getCandidateDossier,
  saveCandidateDossier,
  validateCandidateDossierEnvelope,
} from "../../src/services/candidateDossier.js";

const UPDATED_AT = "2026-08-13T10:20:30.000Z";

/**
 * Build the complete empty CandidateDossier server payload.
 * @returns {object} Empty canonical dossier.
 */
function createEmptyDossier() {
  return {
    schemaVersion: CandidateDossierConstants.SCHEMA_VERSION,
    experiences: [],
    projects: [],
    skills: [],
    education: [],
    languages: [],
    softSkills: [],
  };
}

/**
 * Build one fake Fetch response.
 * @param {object} options - Response options.
 * @param {boolean} options.ok - HTTP success flag.
 * @param {number} options.status - HTTP status.
 * @param {unknown} options.payload - Parsed JSON payload.
 * @returns {object} Fetch response fake.
 */
function createResponse({ ok, status, payload }) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

test("GET uses the singleton endpoint and returns a detached empty envelope", async () => {
  const dossier = createEmptyDossier();
  const calls = [];
  const result = await getCandidateDossier(async (url, options) => {
    calls.push({ url, options });
    return createResponse({ ok: true, status: 200, payload: { dossier, updatedAt: null } });
  });

  assert.deepEqual(calls, [{
    url: "http://localhost:3001/api/dossier-candidat",
    options: { method: "GET" },
  }]);
  assert.deepEqual(result, { dossier, updatedAt: null });
  result.dossier.experiences.push({ id: "external" });
  assert.deepEqual(dossier.experiences, []);
});

test("GET accepts an existing dossier with a string updatedAt", async () => {
  const dossier = createEmptyDossier();
  dossier.skills.push({
    id: "skill-1",
    category: CandidateDossierConstants.SKILL_CATEGORY.TECHNICAL_SKILL,
    value: "Generic skill",
    detail: null,
  });
  const result = await getCandidateDossier(async () => {
    return createResponse({
      ok: true,
      status: 200,
      payload: { dossier, updatedAt: UPDATED_AT },
    });
  });

  assert.deepEqual(result, { dossier, updatedAt: UPDATED_AT });
});

test("PUT sends the complete dossier directly and returns its authoritative envelope", async () => {
  const dossier = createEmptyDossier();
  let captured = null;
  const result = await saveCandidateDossier(dossier, async (url, options) => {
    captured = { url, options };
    return createResponse({
      ok: true,
      status: 200,
      payload: { dossier, updatedAt: UPDATED_AT },
    });
  });

  assert.equal(captured.url, "http://localhost:3001/api/dossier-candidat");
  assert.equal(captured.options.method, "PUT");
  assert.deepEqual(captured.options.headers, { "Content-Type": "application/json" });
  assert.deepEqual(JSON.parse(captured.options.body), dossier);
  assert.equal(Object.hasOwn(JSON.parse(captured.options.body), "dossier"), false);
  assert.deepEqual(result, { dossier, updatedAt: UPDATED_AT });
});

test("HTTP failures retain only status and a public CandidateDossier code", async () => {
  const cases = [
    { status: 422, code: CandidateDossierConstants.ERROR_CODE.INVALID_DOSSIER },
    { status: 500, code: CandidateDossierConstants.ERROR_CODE.PERSISTENCE },
    { status: 500, code: CandidateDossierConstants.ERROR_CODE.INTERNAL },
  ];
  for (const current of cases) {
    await assert.rejects(
      getCandidateDossier(async () => {
        return createResponse({
          ok: false,
          status: current.status,
          payload: { code: current.code, error: "Server public message", private: "hidden" },
        });
      }),
      (error) => {
        assert.equal(error.name, "CandidateDossierHttpError");
        assert.equal(error.status, current.status);
        assert.equal(error.code, current.code);
        assert.equal(Object.hasOwn(error, "private"), false);
        assert.equal(error.message.includes("Server public message"), false);
        return true;
      },
    );
  }
});

test("an unreadable HTTP error body produces a safe code-less error", async () => {
  await assert.rejects(getCandidateDossier(async () => {
    return {
      ok: false,
      status: 500,
      async json() {
        throw new SyntaxError("private malformed body");
      },
    };
  }), (error) => {
    assert.equal(error.status, 500);
    assert.equal(error.code, null);
    assert.equal(error.message.includes("private"), false);
    return true;
  });
});

test("malformed success envelopes are rejected without domain validation duplication", () => {
  for (const payload of [
    null,
    {},
    { dossier: [], updatedAt: null },
    { dossier: createEmptyDossier(), updatedAt: 123 },
  ]) {
    assert.throws(() => {
      validateCandidateDossierEnvelope(payload);
    }, TypeError);
  }
});
