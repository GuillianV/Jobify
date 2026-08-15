import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationBriefLimits } from "../../src/constants/ApplicationBriefLimits.js";
import { CandidateDossier } from "../../src/models/CandidateDossier.js";
import { OfferAnalysis } from "../../src/models/OfferAnalysis.js";
import { ApplicationBrief } from "../../src/models/ApplicationBrief.js";
import { ApplicationBriefAssembler } from "../../src/services/ApplicationBriefAssembler.js";
import { ApplicationBriefBuilder } from "../../src/services/ApplicationBriefBuilder.js";
import { ApplicationBriefContextValidationError } from "../../src/services/ApplicationBriefContextValidationError.js";
import { ApplicationBriefContextValidator } from "../../src/services/ApplicationBriefContextValidator.js";
import { ApplicationBriefEvidenceResolver } from "../../src/services/ApplicationBriefEvidenceResolver.js";
import { ApplicationBriefInputProjector } from "../../src/services/ApplicationBriefInputProjector.js";
import { ApplicationBriefMatcherError } from "../../src/services/ApplicationBriefMatcherError.js";
import { ApplicationBriefOfferRefResolver } from "../../src/services/ApplicationBriefOfferRefResolver.js";
import { ApplicationBriefValidator } from "../../src/services/ApplicationBriefValidator.js";
import { ApplicationBriefValidationError } from "../../src/services/ApplicationBriefValidationError.js";
import { CandidateDossierValidationError } from "../../src/services/CandidateDossierValidationError.js";
import { CandidateDossierFingerprint } from "../../src/services/CandidateDossierFingerprint.js";

const OFFER_IDENTITY = Object.freeze({
  offerId: 1,
  analysisFingerprint: "a".repeat(ApplicationBriefLimits.SHA256_HEX_LENGTH),
  analysisSchemaVersion: "offer-analysis-schema-v1",
  analyzerPolicyVersion: "offer-analyzer-v5",
});
const EXPERIENCE_REF = Object.freeze({
  kind: "EXPERIENCE", itemId: "experience-1", field: "role",
});

/**
 * Build one authoritative analysis with one React requirement.
 * @param {object} [overrides] - Analysis overrides.
 * @returns {OfferAnalysis} Offer fixture.
 */
function createAnalysis(overrides = {}) {
  return new OfferAnalysis({
    seniority: null,
    activities: [{ value: "Build products", assertion: "INFERRED", evidence: null }],
    requirements: [{
      category: "SKILL", value: "React", importance: "REQUIRED",
      assertion: "EXPLICIT", evidence: { text: "React" },
    }],
    context: [],
    workConditions: { workMode: null, constraints: [] },
    ...overrides,
  });
}

/**
 * Build one authoritative candidate dossier.
 * @returns {CandidateDossier} Candidate fixture.
 */
function createDossier() {
  return new CandidateDossier({
    schemaVersion: "candidate-dossier-schema-v1",
    experiences: [{
      id: "experience-1", role: "React Engineer", organization: "Org", client: null,
      startDate: "2024-01", endDate: null, current: true, domain: null,
      activities: [], achievements: [], technologies: ["React"],
    }],
    projects: [], skills: [], education: [], languages: [], softSkills: [],
  });
}

/**
 * Build one non-trivial valid semantic output.
 * @returns {object} Semantic output fixture.
 */
function createSemanticOutput() {
  return {
    requirementMatches: [{
      offerRef: { kind: "REQUIREMENT", index: 0 }, state: "SUPPORTED",
      supportedFacets: [{ text: "React", evidenceRefs: [EXPERIENCE_REF] }],
      notEvidencedFacets: [],
    }],
    emphasis: [{
      priority: "PRIMARY", offerRefs: [{ kind: "ACTIVITY", index: 0 }],
      evidenceRefs: [EXPERIENCE_REF], relevanceReason: "Relevant experience",
    }],
    supportedClaims: [{
      claimType: "EXPERIENCE_FACT", offerRefs: [{ kind: "REQUIREMENT", index: 0 }],
      evidenceRefs: [EXPERIENCE_REF],
    }],
    cautions: [{
      kind: "DURATION_UNSUPPORTED", offerRefs: [{ kind: "REQUIREMENT", index: 0 }],
      evidenceRefs: [EXPERIENCE_REF],
    }],
  };
}

/**
 * Create real deterministic builder dependencies around one fake matcher.
 * @param {object} semanticOutput - Matcher result.
 * @param {object} [overrides] - Dependency overrides.
 * @returns {{builder: ApplicationBriefBuilder, projections: object[], assembler: ApplicationBriefAssembler}} Builder harness.
 */
function createHarness(semanticOutput, overrides = {}) {
  const projections = [];
  const inputProjector = new ApplicationBriefInputProjector();
  const assembler = new ApplicationBriefAssembler({
    evidenceResolver: new ApplicationBriefEvidenceResolver(),
    candidateFingerprint: CandidateDossierFingerprint,
  });
  const contextValidator = new ApplicationBriefContextValidator({
    applicationBriefValidator: new ApplicationBriefValidator(),
    offerRefResolver: new ApplicationBriefOfferRefResolver(),
    evidenceResolver: new ApplicationBriefEvidenceResolver(),
    candidateFingerprint: CandidateDossierFingerprint,
  });
  const builder = new ApplicationBriefBuilder({
    inputProjector,
    semanticMatcher: {
      async match(projection) {
        projections.push(structuredClone(projection));
        return structuredClone(semanticOutput);
      },
    },
    assembler: overrides.assembler ?? assembler,
    contextValidator: overrides.contextValidator ?? contextValidator,
  });
  return { builder, projections, assembler };
}

test("builder returns immutable final brief and sends only the minimal projection", async () => {
  const analysis = createAnalysis();
  const dossier = createDossier();
  const snapshot = { title: "React Engineer" };
  const harness = createHarness(createSemanticOutput());
  const brief = await harness.builder.build({
    offerAnalysis: analysis,
    offerSnapshot: snapshot,
    offerIdentity: OFFER_IDENTITY,
    candidateDossier: dossier,
  });

  assert.equal(brief instanceof ApplicationBrief, true);
  assert.equal(Object.isFrozen(brief), true);
  assert.equal(harness.projections.length, 1);
  assert.deepEqual(harness.projections[0], new ApplicationBriefInputProjector().project({
    offerAnalysis: analysis, offerSnapshot: snapshot, candidateDossier: dossier,
  }));
  assert.equal("offerIdentity" in harness.projections[0], false);
  assert.equal("inputIdentity" in harness.projections[0], false);
  assert.equal(brief.evidenceFacts[0].value, "React Engineer");
  const detached = brief.toJson();
  detached.requirementMatches[0].supportedFacets[0].text = "Changed";
  assert.equal(brief.requirementMatches[0].supportedFacets[0].text, "React");
});

test("hallucinated offer and evidence refs and invalid facets fail as contextual output", async () => {
  const cases = [];
  const badOffer = createSemanticOutput();
  badOffer.requirementMatches[0].offerRef.index = 1;
  cases.push(badOffer);
  const badEvidence = structuredClone(createSemanticOutput());
  badEvidence.requirementMatches[0].supportedFacets[0].evidenceRefs[0].itemId = "missing";
  badEvidence.emphasis[0].evidenceRefs[0].itemId = "missing";
  badEvidence.supportedClaims[0].evidenceRefs[0].itemId = "missing";
  badEvidence.cautions[0].evidenceRefs[0].itemId = "missing";
  cases.push(badEvidence);
  const badFacet = createSemanticOutput();
  badFacet.requirementMatches[0].supportedFacets[0].text = "Vue";
  cases.push(badFacet);

  for (const semanticOutput of cases) {
    const harness = createHarness(semanticOutput);
    await assert.rejects(harness.builder.build({
      offerAnalysis: createAnalysis(), offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
      candidateDossier: createDossier(),
    }), (error) => {
      assert.equal(error instanceof ApplicationBriefMatcherError, true);
      assert.equal(error.code, ApplicationBriefMatcherError.CODE.INVALID_OUTPUT);
      assert.equal(error.reason, ApplicationBriefMatcherError.REASON.INVALID_CONTEXTUAL_OUTPUT);
      return true;
    });
  }
});

test("authoritative stale input remains a contextual error instead of a model error", async () => {
  const baseAssembler = createHarness(createSemanticOutput()).assembler;
  const staleAssembler = {
    assemble(inputs) {
      const assembled = baseAssembler.assemble(inputs);
      assembled.inputIdentity.offer.offerId += 1;
      return assembled;
    },
  };
  const harness = createHarness(createSemanticOutput(), { assembler: staleAssembler });
  await assert.rejects(harness.builder.build({
    offerAnalysis: createAnalysis(), offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
    candidateDossier: createDossier(),
  }), (error) => {
    assert.equal(error instanceof ApplicationBriefContextValidationError, true);
    assert.equal(error.reason, ApplicationBriefContextValidationError.REASON.STALE_INPUT);
    return true;
  });
});

test("final structural errors remain visible as deterministic invariant failures", async () => {
  const harness = createHarness(createSemanticOutput(), {
    assembler: {
      assemble() {
        return {};
      },
    },
  });
  await assert.rejects(harness.builder.build({
    offerAnalysis: createAnalysis(), offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
    candidateDossier: createDossier(),
  }), ApplicationBriefValidationError);
});

test("malformed authoritative offer identity is never blamed on model output", async () => {
  const malformedIdentity = { ...OFFER_IDENTITY, offerId: "invalid" };
  await assert.rejects(createHarness(createSemanticOutput()).builder.build({
    offerAnalysis: createAnalysis(), offerSnapshot: {}, offerIdentity: malformedIdentity,
    candidateDossier: createDossier(),
  }), (error) => {
    assert.equal(error instanceof ApplicationBriefValidationError, true);
    assert.equal(error instanceof ApplicationBriefMatcherError, false);
    return true;
  });
});

test("invalid authoritative candidate remains a candidate input validation error", async () => {
  const invalidValue = createDossier().toJson();
  invalidValue.experiences[0].role = "";
  const invalidDossier = new CandidateDossier(invalidValue);
  await assert.rejects(createHarness(createSemanticOutput()).builder.build({
    offerAnalysis: createAnalysis(), offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
    candidateDossier: invalidDossier,
  }), (error) => {
    assert.equal(error instanceof CandidateDossierValidationError, true);
    assert.equal(error instanceof ApplicationBriefMatcherError, false);
    return true;
  });
});

test("unexpected assembler errors remain unchanged", async () => {
  const internal = new Error("internal failure");
  const harness = createHarness(createSemanticOutput(), {
    assembler: {
      assemble() {
        throw internal;
      },
    },
  });
  await assert.rejects(harness.builder.build({
    offerAnalysis: createAnalysis(), offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
    candidateDossier: createDossier(),
  }), (error) => {
    assert.equal(error, internal);
    return true;
  });
});

test("post-assembly evidence invariant errors remain contextual instead of model errors", async () => {
  const reasons = [
    ApplicationBriefContextValidationError.REASON.INVALID_EVIDENCE_REFERENCE,
    ApplicationBriefContextValidationError.REASON.EVIDENCE_VALUE_MISMATCH,
  ];
  for (const reason of reasons) {
    const original = new ApplicationBriefContextValidationError(reason);
    const harness = createHarness(createSemanticOutput(), {
      contextValidator: {
        validate() {
          throw original;
        },
      },
    });
    await assert.rejects(harness.builder.build({
      offerAnalysis: createAnalysis(), offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
      candidateDossier: createDossier(),
    }), (error) => {
      assert.equal(error, original);
      return true;
    });
  }
});

test("empty candidate produces valid not-evidenced matches without facts", async () => {
  const semanticOutput = {
    requirementMatches: [{
      offerRef: { kind: "REQUIREMENT", index: 0 }, state: "NOT_EVIDENCED",
      supportedFacets: [], notEvidencedFacets: [{ text: "React" }],
    }],
    emphasis: [], supportedClaims: [], cautions: [],
  };
  const brief = await createHarness(semanticOutput).builder.build({
    offerAnalysis: createAnalysis(), offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
    candidateDossier: CandidateDossier.empty(),
  });
  assert.equal(brief instanceof ApplicationBrief, true);
  assert.deepEqual(brief.evidenceFacts, []);
});

test("empty requirements produce a valid empty semantic brief", async () => {
  const semanticOutput = {
    requirementMatches: [], emphasis: [], supportedClaims: [], cautions: [],
  };
  const brief = await createHarness(semanticOutput).builder.build({
    offerAnalysis: createAnalysis({ requirements: [] }),
    offerSnapshot: {},
    offerIdentity: OFFER_IDENTITY,
    candidateDossier: createDossier(),
  });
  assert.equal(brief instanceof ApplicationBrief, true);
  assert.deepEqual(brief.requirementMatches, []);
  assert.deepEqual(brief.evidenceFacts, []);
});
