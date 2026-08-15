import test from "node:test";
import assert from "node:assert/strict";
import { CandidateDossier } from "../../src/models/CandidateDossier.js";
import { OfferAnalysis } from "../../src/models/OfferAnalysis.js";
import { ApplicationBriefInputProjector } from "../../src/services/ApplicationBriefInputProjector.js";

/**
 * Build one offer analysis with excluded evidence and logistics metadata.
 * @returns {OfferAnalysis} Offer analysis fixture.
 */
function createAnalysis() {
  return new OfferAnalysis({
    seniority: { levels: ["SENIOR"], assertion: "EXPLICIT", evidence: { text: "Senior" } },
    activities: [{ value: "Build systems", assertion: "INFERRED", evidence: null }],
    requirements: [{
      category: "TECHNICAL_SKILL", value: "React", importance: "REQUIRED",
      assertion: "EXPLICIT", evidence: { text: "React" },
    }],
    context: [{
      category: "DOMAIN", value: "Healthcare", assertion: "INFERRED", evidence: null,
    }],
    workConditions: {
      workMode: {
        mode: "REMOTE", detail: null, assertion: "EXPLICIT", evidence: { text: "Remote" },
      },
      constraints: [{
        category: "TRAVEL", value: "Travel", assertion: "EXPLICIT", evidence: { text: "Travel" },
      }],
    },
  });
}

/**
 * Build one candidate dossier containing all six collections.
 * @returns {CandidateDossier} Candidate dossier fixture.
 */
function createDossier() {
  return new CandidateDossier({
    schemaVersion: "candidate-dossier-schema-v1",
    experiences: [{
      id: "experience-1", role: "Role", organization: "Organization", client: null,
      startDate: "2024-01", endDate: null, current: true, domain: "Domain",
      activities: ["Second", "First"], achievements: [], technologies: ["React"],
    }],
    projects: [{
      id: "project-1", name: "Project", role: null, startDate: null, endDate: null,
      domain: null, summary: "Summary", activities: [], achievements: [], technologies: [],
    }],
    skills: [{ id: "skill-1", category: "TECHNICAL_SKILL", value: "React", detail: null }],
    education: [{
      id: "education-1", diploma: "Diploma", level: null, field: null,
      institution: null, startDate: null, endDate: null,
    }],
    languages: [{
      id: "language-1", language: "French", overall: null, reading: null,
      writing: null, speaking: null, listening: null,
    }],
    softSkills: [{ id: "soft-1", value: "Communication", detail: null }],
  });
}

test("offer projection has the exact minimal matcher shape and stable refs", () => {
  const projection = new ApplicationBriefInputProjector().project({
    offerAnalysis: createAnalysis(),
    offerSnapshot: {
      title: "Engineer", location: { city: "Paris" }, salary: { raw: "Excluded" },
      contract: { type: "CDI" }, provider: "excluded", cacheKey: "excluded",
    },
    candidateDossier: createDossier(),
  });

  assert.deepEqual(projection.offer, {
    title: "Engineer",
    seniority: { ref: { kind: "SENIORITY" }, levels: ["SENIOR"] },
    activities: [{ ref: { kind: "ACTIVITY", index: 0 }, value: "Build systems" }],
    requirements: [{
      ref: { kind: "REQUIREMENT", index: 0 }, category: "TECHNICAL_SKILL",
      value: "React", importance: "REQUIRED",
    }],
    context: [{ ref: { kind: "CONTEXT", index: 0 }, category: "DOMAIN", value: "Healthcare" }],
  });
  for (const excluded of [
    "workConditions", "workMode", "constraints", "location", "salary", "contract",
    "provider", "cacheKey", "evidence", "assertion",
  ]) {
    assert.equal(JSON.stringify(projection.offer).includes(excluded), false);
  }
});

test("candidate projection preserves six factual collections IDs nulls dates and array order", () => {
  const dossier = createDossier();
  const projection = new ApplicationBriefInputProjector().project({
    offerAnalysis: createAnalysis(), offerSnapshot: { title: null }, candidateDossier: dossier,
  });

  assert.deepEqual(Object.keys(projection.candidate), [
    "experiences", "projects", "skills", "education", "languages", "softSkills",
  ]);
  assert.deepEqual(projection.candidate.experiences[0], {
    kind: "EXPERIENCE", itemId: "experience-1", role: "Role",
    organization: "Organization", client: null, startDate: "2024-01", endDate: null,
    current: true, domain: "Domain", activities: ["Second", "First"], achievements: [],
    technologies: ["React"],
  });
  assert.equal(projection.candidate.projects[0].kind, "PROJECT");
  assert.equal(projection.candidate.skills[0].kind, "SKILL");
  assert.equal(projection.candidate.education[0].kind, "EDUCATION");
  assert.equal(projection.candidate.languages[0].kind, "LANGUAGE");
  assert.equal(projection.candidate.softSkills[0].kind, "SOFT_SKILL");
  assert.equal(Object.hasOwn(projection.candidate, "schemaVersion"), false);
  assert.equal(JSON.stringify(projection.candidate).includes("updatedAt"), false);
});

test("projection is detached and mutation leaves all inputs unchanged", () => {
  const analysis = createAnalysis();
  const dossier = createDossier();
  const snapshot = { title: "Engineer", location: { city: "Paris" } };
  const beforeAnalysis = analysis.toJson();
  const beforeDossier = dossier.toJson();
  const beforeSnapshot = structuredClone(snapshot);
  const projection = new ApplicationBriefInputProjector().project({
    offerAnalysis: analysis, offerSnapshot: snapshot, candidateDossier: dossier,
  });

  projection.offer.seniority.levels.push("LEAD");
  projection.candidate.experiences[0].activities.reverse();
  projection.offer.title = "Changed";
  assert.deepEqual(analysis.toJson(), beforeAnalysis);
  assert.deepEqual(dossier.toJson(), beforeDossier);
  assert.deepEqual(snapshot, beforeSnapshot);
});
