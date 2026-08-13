import test from "node:test";
import assert from "node:assert/strict";
import { CandidateDossierConstants } from "../../src/constants/CandidateDossierConstants.js";
import { CandidateDossier } from "../../src/models/CandidateDossier.js";

/**
 * Build one complete empty CandidateDossier value.
 * @returns {object} Complete empty contract value.
 */
function emptyValue() {
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

test("CandidateDossier constructs an immutable detached empty domain value", () => {
  const input = emptyValue();
  const dossier = new CandidateDossier(input);
  input.experiences.push({ id: "external" });

  assert.equal(dossier.schemaVersion, CandidateDossierConstants.SCHEMA_VERSION);
  assert.deepEqual(dossier.experiences, []);
  assert.equal(Object.isFrozen(dossier), true);
  assert.equal(Object.isFrozen(dossier.experiences), true);
  assert.throws(() => {
    dossier.projects.push({ id: "mutation" });
  }, TypeError);
});

test("CandidateDossier toJson is deterministic and deeply detached", () => {
  const dossier = new CandidateDossier(emptyValue());
  const first = dossier.toJson();
  const second = dossier.toJson();
  first.skills.push({ id: "external" });

  assert.deepEqual(second, emptyValue());
  assert.deepEqual(dossier.toJson(), emptyValue());
  assert.notEqual(first, second);
});

test("CandidateDossier empty creates independent official immutable domain values", () => {
  const first = CandidateDossier.empty();
  const second = CandidateDossier.empty();
  const firstJson = first.toJson();

  assert.equal(first instanceof CandidateDossier, true);
  assert.equal(second instanceof CandidateDossier, true);
  assert.deepEqual(firstJson, emptyValue());
  assert.equal(first.schemaVersion, CandidateDossierConstants.SCHEMA_VERSION);
  assert.equal(Object.isFrozen(first), true);
  for (const key of [
    "experiences", "projects", "skills", "education", "languages", "softSkills",
  ]) {
    assert.equal(Object.isFrozen(first[key]), true);
    assert.notEqual(first[key], second[key]);
  }
  firstJson.experiences.push({ id: "external" });
  assert.deepEqual(first.toJson(), emptyValue());
  assert.deepEqual(second.toJson(), emptyValue());
});
