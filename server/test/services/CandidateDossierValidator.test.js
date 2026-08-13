import test from "node:test";
import assert from "node:assert/strict";
import { CandidateDossierConstants } from "../../src/constants/CandidateDossierConstants.js";
import { CandidateDossierLimits } from "../../src/constants/CandidateDossierLimits.js";
import { CandidateDossier } from "../../src/models/CandidateDossier.js";
import { CandidateDossierValidationError } from "../../src/services/CandidateDossierValidationError.js";
import { CandidateDossierValidator } from "../../src/services/CandidateDossierValidator.js";

/**
 * Build one complete generic CandidateDossier fixture.
 * @returns {object} Complete valid contract value.
 */
function createDossier() {
  return {
    schemaVersion: CandidateDossierConstants.SCHEMA_VERSION,
    experiences: [{
      id: "exp-1", role: "Generic role", organization: "Generic organization", client: null,
      startDate: "2024-01", endDate: "2025-06", current: false, domain: "Generic domain",
      activities: ["Generic activity"], achievements: ["Generic achievement"],
      technologies: ["Generic technology"],
    }],
    projects: [{
      id: "project-1", name: "Generic project", role: null, startDate: null, endDate: null,
      domain: null, summary: "Generic summary", activities: [], achievements: [], technologies: [],
    }],
    skills: [
      { id: "skill-1", category: "TECHNICAL_SKILL", value: "Generic technique", detail: null },
      { id: "skill-2", category: "FUNCTIONAL_SKILL", value: "Generic function", detail: null },
      { id: "skill-3", category: "TOOL_OR_TECHNOLOGY", value: "Generic tool", detail: null },
    ],
    education: [{
      id: "edu-1", diploma: "Generic diploma", level: null, field: null, institution: null,
      startDate: null, endDate: null,
    }],
    languages: [{
      id: "lang-1", language: "Generic language", overall: null, reading: "professional",
      writing: "professional", speaking: "limited", listening: null,
    }],
    softSkills: [{ id: "soft-1", value: "Generic soft skill", detail: null }],
  };
}

/**
 * Assert that one candidate fails with the expected safe validation code.
 * @param {object} candidate - Invalid dossier candidate.
 * @param {string} code - Expected validation code.
 * @returns {void}
 */
function expectCode(candidate, code) {
  assert.throws(() => {
    new CandidateDossierValidator().validate(candidate);
  }, (error) => {
    assert.equal(error instanceof CandidateDossierValidationError, true);
    assert.equal(error.validationCode, code);
    return true;
  });
}

test("validator accepts every factual V1 collection without rewriting input", () => {
  const input = createDossier();
  const snapshot = structuredClone(input);
  const result = new CandidateDossierValidator().validate(input);

  assert.equal(result instanceof CandidateDossier, true);
  assert.deepEqual(result.toJson(), snapshot);
  assert.deepEqual(input, snapshot);
  assert.equal(Object.hasOwn(result, "yearsOfExperience"), false);
  assert.equal(Object.hasOwn(result, "seniority"), false);
  assert.equal(Object.hasOwn(result, "workConditions"), false);
});

test("an empty but complete dossier is structurally valid", () => {
  const input = createDossier();
  for (const key of ["experiences", "projects", "skills", "education", "languages", "softSkills"]) {
    input[key] = [];
  }
  assert.deepEqual(new CandidateDossierValidator().validate(input).toJson(), input);
});

test("stable IDs reject empty whitespace oversized invalid and duplicate values", () => {
  const values = ["", "   ", "invalid id", "x".repeat(CandidateDossierLimits.MAXIMUM_ID_LENGTH + 1)];
  for (const value of values) {
    const input = createDossier();
    input.skills[0].id = value;
    expectCode(input, CandidateDossierValidationError.CODE.INVALID_ID);
  }
  const duplicate = createDossier();
  duplicate.skills[1].id = duplicate.skills[0].id;
  expectCode(duplicate, CandidateDossierValidationError.CODE.DUPLICATE_ID);
});

test("strict root whitelist rejects logistics contact other and generic fields", () => {
  for (const field of [
    "location", "mobility", "availability", "workPreference", "other", "email", "phone", "unknown",
  ]) {
    const input = createDossier();
    input[field] = "forbidden";
    expectCode(input, CandidateDossierValidationError.CODE.UNKNOWN_FIELD);
  }
});

test("strict nested whitelist rejects identity contact and derived facts", () => {
  for (const field of ["name", "address", "expertiseLevel", "yearsOfExperience", "seniority"]) {
    const input = createDossier();
    input.experiences[0][field] = "forbidden";
    expectCode(input, CandidateDossierValidationError.CODE.UNKNOWN_FIELD);
  }
});

test("skills accept only the three exact aligned categories", () => {
  for (const category of ["OTHER", "UNKNOWN", "SOFT_SKILL"]) {
    const input = createDossier();
    input.skills[0].category = category;
    expectCode(input, CandidateDossierValidationError.CODE.INVALID_ENUM);
  }
});

test("dates require YYYY-MM chronological ranges and current experience invariants", () => {
  const valid = createDossier();
  valid.experiences[0].startDate = "2020-12";
  valid.experiences[0].endDate = "2021-01";
  assert.equal(new CandidateDossierValidator().validate(valid) instanceof CandidateDossier, true);

  const malformed = createDossier();
  malformed.projects[0].startDate = "2024-1";
  expectCode(malformed, CandidateDossierValidationError.CODE.INVALID_DATE);

  for (const invalidMonth of ["2024-00", "2024-13", "2024-99"]) {
    const invalid = createDossier();
    invalid.projects[0].startDate = invalidMonth;
    expectCode(invalid, CandidateDossierValidationError.CODE.INVALID_DATE);
  }

  const reversed = createDossier();
  reversed.education[0].startDate = "2025-01";
  reversed.education[0].endDate = "2024-12";
  expectCode(reversed, CandidateDossierValidationError.CODE.INVALID_DATE);

  const current = createDossier();
  current.experiences[0].current = true;
  expectCode(current, CandidateDossierValidationError.CODE.INVALID_INVARIANT);
});

test("language dimensions remain independent free text and nullable", () => {
  const result = new CandidateDossierValidator().validate(createDossier());
  assert.deepEqual(result.languages[0], {
    id: "lang-1", language: "Generic language", overall: null, reading: "professional",
    writing: "professional", speaking: "limited", listening: null,
  });
});

test("major collection nested text and ID limits are enforced", () => {
  const collection = createDossier();
  collection.experiences = Array.from(
    { length: CandidateDossierLimits.MAXIMUM_EXPERIENCES + 1 },
    (_, index) => {
      return { ...createDossier().experiences[0], id: `exp-${index}` };
    },
  );
  expectCode(collection, CandidateDossierValidationError.CODE.LIMIT_EXCEEDED);

  const nested = createDossier();
  nested.projects[0].activities = Array.from(
    { length: CandidateDossierLimits.MAXIMUM_ACTIVITIES + 1 },
    () => {
      return "Generic activity";
    },
  );
  expectCode(nested, CandidateDossierValidationError.CODE.LIMIT_EXCEEDED);

  const text = createDossier();
  text.skills[0].value = "x".repeat(CandidateDossierLimits.MAXIMUM_TEXT_LENGTH + 1);
  expectCode(text, CandidateDossierValidationError.CODE.LIMIT_EXCEEDED);
});

test("validation error exposes only its closed safe taxonomy", () => {
  assert.deepEqual(Object.values(CandidateDossierValidationError.CODE), [
    "INVALID_STRUCTURE", "UNKNOWN_FIELD", "INVALID_ENUM", "INVALID_ID", "DUPLICATE_ID",
    "INVALID_TEXT", "INVALID_DATE", "LIMIT_EXCEEDED", "INVALID_INVARIANT",
  ]);
  assert.throws(() => {
    new CandidateDossierValidationError({ validationCode: "UNKNOWN", message: "x" });
  }, TypeError);
});
