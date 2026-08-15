import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CandidateDossierConstants } from "../../src/constants/CandidateDossierConstants.js";
import { CandidateDossier } from "../../src/models/CandidateDossier.js";
import { CandidateDossierFingerprint } from "../../src/services/CandidateDossierFingerprint.js";
import { CandidateDossierValidationError } from "../../src/services/CandidateDossierValidationError.js";

/**
 * Build one valid dossier containing nullable and ordered values.
 * @returns {object} Valid CandidateDossier V1 value.
 */
function createDossier() {
  return {
    schemaVersion: CandidateDossierConstants.SCHEMA_VERSION,
    experiences: [{
      id: "exp-1", role: "Role", organization: "Organization", client: null,
      startDate: "2024-01", endDate: null, current: true, domain: "Domain",
      activities: ["First", "Second"], achievements: [], technologies: ["Tool"],
    }],
    projects: [],
    skills: [],
    education: [],
    languages: [],
    softSkills: [],
  };
}

/**
 * Hash one canonical serialization to test the raw schema-sensitive primitive.
 * @param {unknown} value - Canonical input.
 * @returns {string} SHA-256 fingerprint.
 */
function hashCanonical(value) {
  return createHash("sha256")
    .update(Buffer.from(CandidateDossierFingerprint.canonicalSerialize(value), "utf8"))
    .digest("hex");
}

test("identical validated dossier content produces one lowercase SHA-256", () => {
  const dossier = createDossier();
  const first = CandidateDossierFingerprint.compute(dossier);
  const second = CandidateDossierFingerprint.compute(structuredClone(dossier));

  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/u);
});

test("object insertion order does not affect canonical dossier fingerprint", () => {
  const dossier = createDossier();
  const reversed = Object.fromEntries(Object.entries(dossier).reverse());
  reversed.experiences = dossier.experiences.map((experience) => {
    return Object.fromEntries(Object.entries(experience).reverse());
  });

  assert.equal(
    CandidateDossierFingerprint.compute(dossier),
    CandidateDossierFingerprint.compute(reversed),
  );
});

test("value nullable value and array order changes affect fingerprint", () => {
  const original = createDossier();
  const changedValue = structuredClone(original);
  changedValue.experiences[0].role = "Other role";
  const changedNull = structuredClone(original);
  changedNull.experiences[0].client = "Client";
  const reordered = structuredClone(original);
  reordered.experiences[0].activities.reverse();
  const fingerprint = CandidateDossierFingerprint.compute(original);

  assert.notEqual(CandidateDossierFingerprint.compute(changedValue), fingerprint);
  assert.notEqual(CandidateDossierFingerprint.compute(changedNull), fingerprint);
  assert.notEqual(CandidateDossierFingerprint.compute(reordered), fingerprint);
});

test("canonical serialization retains schema null booleans strings and array order", () => {
  const first = { schemaVersion: "v1", values: ["A", null, true] };
  const second = { schemaVersion: "v2", values: ["A", null, true] };
  const reordered = { schemaVersion: "v1", values: [true, null, "A"] };

  assert.notEqual(
    hashCanonical(first),
    hashCanonical(second),
  );
  assert.notEqual(
    hashCanonical(first),
    hashCanonical(reordered),
  );
});

test("invalid dossiers are rejected before fingerprinting", () => {
  const invalid = createDossier();
  invalid.schemaVersion = "other-schema";

  assert.throws(() => {
    CandidateDossierFingerprint.compute(invalid);
  }, CandidateDossierValidationError);
});

test("CandidateDossier instance and equivalent plain content share one deterministic fingerprint", () => {
  const plain = createDossier();
  const instance = new CandidateDossier(plain);
  const first = CandidateDossierFingerprint.compute(instance);
  const second = CandidateDossierFingerprint.compute(instance);

  assert.equal(first, CandidateDossierFingerprint.compute(plain));
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/u);
});
