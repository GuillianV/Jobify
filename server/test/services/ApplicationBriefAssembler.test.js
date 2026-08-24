import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationBriefConstants } from "../../src/constants/ApplicationBriefConstants.js";
import { ApplicationBriefLimits } from "../../src/constants/ApplicationBriefLimits.js";
import { CandidateDossier } from "../../src/models/CandidateDossier.js";
import { ApplicationBriefAssembler } from "../../src/services/ApplicationBriefAssembler.js";
import { ApplicationBriefContextValidationError } from "../../src/services/ApplicationBriefContextValidationError.js";
import { ApplicationBriefEvidenceResolver } from "../../src/services/ApplicationBriefEvidenceResolver.js";
import { ApplicationBriefSemanticOutputValidator } from "../../src/services/ApplicationBriefSemanticOutputValidator.js";
import { ApplicationBriefValidator } from "../../src/services/ApplicationBriefValidator.js";
import { CandidateDossierFingerprint } from "../../src/services/CandidateDossierFingerprint.js";

const OFFER_IDENTITY = Object.freeze({
  offerId: 1,
  analysisFingerprint: "a".repeat(ApplicationBriefLimits.SHA256_HEX_LENGTH),
  analysisSchemaVersion: "offer-analysis-schema-v1",
  analyzerPolicyVersion: "offer-analyzer-v5",
});
const PROJECT_ACTIVITY_REF = Object.freeze({
  kind: "PROJECT", itemId: "project-1", field: "activities[0]",
});
const EXPERIENCE_CURRENT_REF = Object.freeze({
  kind: "EXPERIENCE", itemId: "experience-1", field: "current",
});
const SKILL_REF = Object.freeze({ kind: "SKILL", itemId: "skill-1", field: "value" });

/**
 * Build a candidate dossier with project, false boolean and skill evidence.
 * @returns {CandidateDossier} Candidate fixture.
 */
function createDossier() {
  return new CandidateDossier({
    schemaVersion: "candidate-dossier-schema-v1",
    experiences: [{
      id: "experience-1", role: "Engineer", organization: "Org", client: null,
      startDate: "2024-01", endDate: "2024-02", current: false, domain: null,
      activities: [], achievements: [], technologies: [],
    }],
    projects: [{
      id: "project-1", name: "Platform", role: null, startDate: null, endDate: null,
      domain: null, summary: null, activities: ["Built React UI"], achievements: [],
      technologies: ["React"],
    }],
    skills: [{
      id: "skill-1", category: "TOOL_OR_TECHNOLOGY", value: "React", detail: null,
    }],
    education: [], languages: [], softSkills: [],
  });
}

/**
 * Build a non-trivial valid semantic output.
 * @returns {object} Semantic fixture.
 */
function createSemanticOutput() {
  return {
    requirementMatches: [{
      offerRef: { kind: "REQUIREMENT", index: 0 }, state: "SUPPORTED",
      supportedFacets: [{ text: "React", evidenceRefs: [PROJECT_ACTIVITY_REF] }],
      notEvidencedFacets: [],
    }],
    emphasis: [{
      priority: "PRIMARY", offerRefs: [{ kind: "ACTIVITY", index: 0 }],
      evidenceRefs: [PROJECT_ACTIVITY_REF, EXPERIENCE_CURRENT_REF],
      relevanceReason: "Relevant evidence",
    }],
    supportedClaims: [{
      claimType: "PROJECT_FACT", offerRefs: [{ kind: "REQUIREMENT", index: 0 }],
      evidenceRefs: [PROJECT_ACTIVITY_REF],
    }, {
      claimType: "SKILL_DECLARATION", offerRefs: [{ kind: "REQUIREMENT", index: 0 }],
      evidenceRefs: [SKILL_REF],
    }],
    cautions: [{
      kind: "DURATION_UNSUPPORTED", offerRefs: [{ kind: "REQUIREMENT", index: 0 }],
      evidenceRefs: [PROJECT_ACTIVITY_REF],
    }],
  };
}

/**
 * Create the real deterministic assembler.
 * @returns {ApplicationBriefAssembler} Assembler fixture.
 */
function createAssembler() {
  return new ApplicationBriefAssembler({
    evidenceResolver: new ApplicationBriefEvidenceResolver(),
    candidateFingerprint: CandidateDossierFingerprint,
  });
}

test("assembler creates deterministic identity facts and first-occurrence order", () => {
  const dossier = createDossier();
  const semanticOutput = new ApplicationBriefSemanticOutputValidator()
    .validate(createSemanticOutput());
  const assembled = createAssembler().assemble({
    semanticOutput, offerIdentity: OFFER_IDENTITY, candidateDossier: dossier,
  });

  assert.equal(assembled.schemaVersion, ApplicationBriefConstants.SCHEMA_VERSION);
  assert.deepEqual(assembled.inputIdentity.offer, OFFER_IDENTITY);
  assert.equal(assembled.inputIdentity.candidate.fingerprint,
    CandidateDossierFingerprint.compute(dossier));
  assert.equal(assembled.inputIdentity.candidate.schemaVersion, dossier.schemaVersion);
  assert.deepEqual(assembled.evidenceFacts, [{
    ref: PROJECT_ACTIVITY_REF, value: "Built React UI",
  }, {
    ref: EXPERIENCE_CURRENT_REF, value: false,
  }, {
    ref: SKILL_REF, value: "React",
  }]);
  assert.equal(JSON.stringify(assembled).includes("application-brief-matcher-v1"), false);
  assert.equal("matcherPolicyVersion" in assembled, false);
});

test("validated semantic output assembles into the non-trivial 9A.1 contract", () => {
  const dossier = createDossier();
  const semanticOutput = new ApplicationBriefSemanticOutputValidator()
    .validate(createSemanticOutput());
  const assembled = createAssembler().assemble({
    semanticOutput, offerIdentity: OFFER_IDENTITY, candidateDossier: dossier,
  });
  assert.doesNotThrow(() => {
    new ApplicationBriefValidator().validate(assembled);
  });
});

test("assembled mutations cannot change semantic identity or candidate inputs", () => {
  const dossier = createDossier();
  const semanticOutput = createSemanticOutput();
  const semanticSnapshot = structuredClone(semanticOutput);
  const identitySnapshot = structuredClone(OFFER_IDENTITY);
  const dossierSnapshot = dossier.toJson();
  const assembled = createAssembler().assemble({
    semanticOutput, offerIdentity: OFFER_IDENTITY, candidateDossier: dossier,
  });
  assembled.requirementMatches[0].supportedFacets[0].text = "Changed";
  assembled.inputIdentity.offer.analysisFingerprint = "b".repeat(
    ApplicationBriefLimits.SHA256_HEX_LENGTH,
  );
  assembled.evidenceFacts[0].ref.itemId = "changed";

  assert.deepEqual(semanticOutput, semanticSnapshot);
  assert.deepEqual(OFFER_IDENTITY, identitySnapshot);
  assert.deepEqual(dossier.toJson(), dossierSnapshot);
});

test("assembly preserves closed resolver diagnostics without exposing the reference", () => {
  const semanticOutput = new ApplicationBriefSemanticOutputValidator()
    .validate(createSemanticOutput());
  semanticOutput.requirementMatches[0].supportedFacets[0].evidenceRefs[0].itemId = "missing";

  assert.throws(() => {
    createAssembler().assemble({
      semanticOutput, offerIdentity: OFFER_IDENTITY, candidateDossier: createDossier(),
    });
  }, (error) => {
    assert.equal(error instanceof ApplicationBriefContextValidationError, true);
    assert.equal(
      error.reason,
      ApplicationBriefContextValidationError.REASON.INVALID_EVIDENCE_REFERENCE,
    );
    assert.deepEqual(error.safeDetails, {
      evidenceReferenceFailure: "ITEM_NOT_FOUND_FOR_KIND",
      evidenceKind: "PROJECT",
      evidenceFieldClass: "INDEXED",
    });
    return true;
  });
});
