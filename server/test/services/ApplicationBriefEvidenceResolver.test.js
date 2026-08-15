import test from "node:test";
import assert from "node:assert/strict";
import { CandidateDossier } from "../../src/models/CandidateDossier.js";
import { ApplicationBriefContextValidationError } from "../../src/services/ApplicationBriefContextValidationError.js";
import { ApplicationBriefEvidenceResolver } from "../../src/services/ApplicationBriefEvidenceResolver.js";

/**
 * Build candidate facts covering every evidence collection and field family.
 * @param {boolean} [current] - Experience current value.
 * @returns {CandidateDossier} Candidate dossier fixture.
 */
function createDossier(current = false) {
  return new CandidateDossier({
    schemaVersion: "candidate-dossier-schema-v1",
    experiences: [{
      id: "same-id", role: "Experience role", organization: "Organization", client: null,
      startDate: "2024-01", endDate: current ? null : "2024-12", current, domain: "Domain",
      activities: ["Activity"], achievements: ["Achievement"], technologies: ["Technology"],
    }],
    projects: [{
      id: "same-id", name: "Project name", role: null, startDate: null, endDate: null,
      domain: null, summary: "Project summary", activities: ["Project activity"],
      achievements: ["Project achievement"], technologies: ["Project technology"],
    }],
    skills: [{ id: "skill-1", category: "TECHNICAL_SKILL", value: "Skill", detail: null }],
    education: [{
      id: "education-1", diploma: "Diploma", level: null, field: null,
      institution: null, startDate: null, endDate: null,
    }],
    languages: [{
      id: "language-1", language: "French", overall: "Native", reading: null,
      writing: null, speaking: null, listening: null,
    }],
    softSkills: [{ id: "soft-1", value: "Communication", detail: null }],
  });
}

/**
 * Assert the closed invalid evidence reference reason.
 * @param {Function} action - Failing resolver call.
 * @returns {void}
 */
function expectInvalidEvidenceRef(action) {
  assert.throws(action, (error) => {
    assert.equal(error instanceof ApplicationBriefContextValidationError, true);
    assert.equal(
      error.reason,
      ApplicationBriefContextValidationError.REASON.INVALID_EVIDENCE_REFERENCE,
    );
    return true;
  });
}

test("evidence resolver resolves exact scalar facts for all six kinds", () => {
  const dossier = createDossier();
  const resolver = new ApplicationBriefEvidenceResolver();
  const cases = [
    [{ kind: "EXPERIENCE", itemId: "same-id", field: "role" }, "Experience role"],
    [{ kind: "PROJECT", itemId: "same-id", field: "name" }, "Project name"],
    [{ kind: "SKILL", itemId: "skill-1", field: "value" }, "Skill"],
    [{ kind: "EDUCATION", itemId: "education-1", field: "diploma" }, "Diploma"],
    [{ kind: "LANGUAGE", itemId: "language-1", field: "language" }, "French"],
    [{ kind: "SOFT_SKILL", itemId: "soft-1", field: "value" }, "Communication"],
  ];
  for (const [reference, expected] of cases) {
    assert.equal(resolver.resolve(dossier, reference), expected);
  }
});

test("same ID in experience and project remains collection scoped", () => {
  const dossier = createDossier();
  const resolver = new ApplicationBriefEvidenceResolver();
  assert.equal(
    resolver.resolve(dossier, { kind: "EXPERIENCE", itemId: "same-id", field: "role" }),
    "Experience role",
  );
  assert.equal(
    resolver.resolve(dossier, { kind: "PROJECT", itemId: "same-id", field: "name" }),
    "Project name",
  );
});

test("array fields resolve exact indexed values and reject absent indexes", () => {
  const dossier = createDossier();
  const resolver = new ApplicationBriefEvidenceResolver();
  assert.equal(
    resolver.resolve(dossier, { kind: "EXPERIENCE", itemId: "same-id", field: "activities[0]" }),
    "Activity",
  );
  assert.equal(
    resolver.resolve(dossier, { kind: "PROJECT", itemId: "same-id", field: "achievements[0]" }),
    "Project achievement",
  );
  assert.equal(
    resolver.resolve(dossier, { kind: "EXPERIENCE", itemId: "same-id", field: "technologies[0]" }),
    "Technology",
  );
  expectInvalidEvidenceRef(() => {
    resolver.resolve(dossier, { kind: "EXPERIENCE", itemId: "same-id", field: "activities[1]" });
  });
});

test("missing items and nullable fields fail closed", () => {
  const dossier = createDossier();
  const resolver = new ApplicationBriefEvidenceResolver();
  expectInvalidEvidenceRef(() => {
    resolver.resolve(dossier, { kind: "SKILL", itemId: "missing", field: "value" });
  });
  expectInvalidEvidenceRef(() => {
    resolver.resolve(dossier, { kind: "EXPERIENCE", itemId: "same-id", field: "client" });
  });
  expectInvalidEvidenceRef(() => {
    resolver.resolve(dossier, { kind: "PROJECT", itemId: "same-id", field: "role" });
  });
});

test("current resolves exact false and true booleans without coercion", () => {
  const resolver = new ApplicationBriefEvidenceResolver();
  const reference = { kind: "EXPERIENCE", itemId: "same-id", field: "current" };
  assert.equal(resolver.resolve(createDossier(false), reference), false);
  assert.equal(resolver.resolve(createDossier(true), reference), true);
});
