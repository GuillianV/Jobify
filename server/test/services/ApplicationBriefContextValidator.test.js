import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationBriefConstants } from "../../src/constants/ApplicationBriefConstants.js";
import { ApplicationBriefLimits } from "../../src/constants/ApplicationBriefLimits.js";
import { CandidateDossier } from "../../src/models/CandidateDossier.js";
import { OfferAnalysis } from "../../src/models/OfferAnalysis.js";
import { ApplicationBriefContextValidationError } from "../../src/services/ApplicationBriefContextValidationError.js";
import { ApplicationBriefContextValidator } from "../../src/services/ApplicationBriefContextValidator.js";
import { ApplicationBriefEvidenceResolver } from "../../src/services/ApplicationBriefEvidenceResolver.js";
import { ApplicationBriefOfferRefResolver } from "../../src/services/ApplicationBriefOfferRefResolver.js";
import { ApplicationBriefValidationError } from "../../src/services/ApplicationBriefValidationError.js";
import { ApplicationBriefValidator } from "../../src/services/ApplicationBriefValidator.js";
import { CandidateDossierFingerprint } from "../../src/services/CandidateDossierFingerprint.js";

const OFFER_ID = 1;
const ANALYSIS_FINGERPRINT = "a".repeat(ApplicationBriefLimits.SHA256_HEX_LENGTH);
const POLICY_VERSION = "offer-analyzer-v1";

/**
 * Build one authoritative offer analysis with two requirements and other offer facts.
 * @param {object} [overrides] - Analysis root overrides.
 * @returns {OfferAnalysis} Offer analysis fixture.
 */
function createAnalysis(overrides = {}) {
  return new OfferAnalysis({
    seniority: { levels: ["SENIOR"], assertion: "EXPLICIT", evidence: { text: "Senior" } },
    activities: [{ value: "Build products", assertion: "INFERRED", evidence: null }],
    requirements: [
      {
        category: "EXPERIENCE", value: "5 ans de React", importance: "REQUIRED",
        assertion: "EXPLICIT", evidence: { text: "5 ans de React" },
      },
      {
        category: "LANGUAGE", value: "Français courant", importance: "REQUIRED",
        assertion: "EXPLICIT", evidence: { text: "Français courant" },
      },
    ],
    context: [{ category: "DOMAIN", value: "Health", assertion: "INFERRED", evidence: null }],
    workConditions: { workMode: null, constraints: [] },
    ...overrides,
  });
}

/**
 * Build one valid authoritative candidate dossier.
 * @param {string} [role] - Experience role value.
 * @returns {CandidateDossier} Candidate dossier fixture.
 */
function createDossier(role = "React Engineer") {
  return new CandidateDossier({
    schemaVersion: "candidate-dossier-schema-v1",
    experiences: [{
      id: "experience-1", role, organization: "Organization", client: null,
      startDate: "2024-01", endDate: null, current: true, domain: null,
      activities: [], achievements: [], technologies: ["React"],
    }],
    projects: [], skills: [], education: [], languages: [], softSkills: [],
  });
}

/**
 * Build the exact injected offer identity.
 * @param {object} [overrides] - Identity overrides.
 * @returns {object} Authoritative offer identity.
 */
function createOfferIdentity(overrides = {}) {
  return {
    offerId: OFFER_ID,
    analysisFingerprint: ANALYSIS_FINGERPRINT,
    analysisSchemaVersion: "offer-analysis-schema-v1",
    analyzerPolicyVersion: POLICY_VERSION,
    ...overrides,
  };
}

/**
 * Build a complete structurally valid brief with exact requirement coverage.
 * @param {OfferAnalysis} analysis - Authoritative offer analysis.
 * @param {CandidateDossier} dossier - Authoritative candidate dossier.
 * @returns {object} Structurally valid contextual brief fixture.
 */
function createBrief(analysis, dossier) {
  return {
    schemaVersion: ApplicationBriefConstants.SCHEMA_VERSION,
    inputIdentity: {
      offer: createOfferIdentity(),
      candidate: {
        fingerprint: CandidateDossierFingerprint.compute(dossier),
        schemaVersion: dossier.schemaVersion,
      },
    },
    requirementMatches: analysis.requirements.map((requirement, index) => {
      return {
        offerRef: { kind: "REQUIREMENT", index }, state: "NOT_EVIDENCED",
        supportedFacets: [], notEvidencedFacets: [{ text: requirement.value }],
      };
    }),
    evidenceFacts: [], emphasis: [], supportedClaims: [], cautions: [],
  };
}

/**
 * Create one contextual validator with real deterministic collaborators.
 * @returns {ApplicationBriefContextValidator} Contextual validator.
 */
function createValidator() {
  return new ApplicationBriefContextValidator({
    applicationBriefValidator: new ApplicationBriefValidator(),
    offerRefResolver: new ApplicationBriefOfferRefResolver(),
    evidenceResolver: new ApplicationBriefEvidenceResolver(),
    candidateFingerprint: CandidateDossierFingerprint,
  });
}

/**
 * Build the exact authoritative context envelope.
 * @param {OfferAnalysis} analysis - Offer analysis.
 * @param {CandidateDossier} dossier - Candidate dossier.
 * @param {object} [offerIdentity] - Offer identity.
 * @returns {object} Authoritative context.
 */
function createContext(analysis, dossier, offerIdentity = createOfferIdentity()) {
  return { offerAnalysis: analysis, offerIdentity, candidateDossier: dossier };
}

/**
 * Assert one closed contextual validation reason.
 * @param {Function} action - Failing validation call.
 * @param {string} reason - Expected closed reason.
 * @returns {void}
 */
function expectReason(action, reason) {
  assert.throws(action, (error) => {
    assert.equal(error instanceof ApplicationBriefContextValidationError, true);
    assert.equal(error.code, "INVALID_APPLICATION_BRIEF_CONTEXT");
    assert.equal(error.reason, reason);
    return true;
  });
}

test("context validation accepts exact coverage identities facts and facets without mutation", () => {
  const analysis = createAnalysis();
  const dossier = createDossier();
  const brief = createBrief(analysis, dossier);
  brief.requirementMatches[0] = {
    offerRef: { kind: "REQUIREMENT", index: 0 }, state: "SUPPORTED",
    supportedFacets: [{
      text: "React",
      evidenceRefs: [{ kind: "EXPERIENCE", itemId: "experience-1", field: "role" }],
    }],
    notEvidencedFacets: [],
  };
  brief.evidenceFacts = [{
    ref: { kind: "EXPERIENCE", itemId: "experience-1", field: "role" },
    value: "React Engineer",
  }];
  const context = createContext(analysis, dossier);
  const briefSnapshot = structuredClone(brief);
  const analysisSnapshot = analysis.toJson();
  const dossierSnapshot = dossier.toJson();
  const result = createValidator().validate(brief, context);

  assert.deepEqual(result.toJson(), briefSnapshot);
  assert.deepEqual(brief, briefSnapshot);
  assert.deepEqual(analysis.toJson(), analysisSnapshot);
  assert.deepEqual(dossier.toJson(), dossierSnapshot);
});

test("structural validation always runs first and preserves its error type", () => {
  const analysis = createAnalysis();
  const dossier = createDossier();
  const invalid = createBrief(analysis, dossier);
  delete invalid.cautions;

  assert.throws(() => {
    createValidator().validate(invalid, null);
  }, ApplicationBriefValidationError);
});

test("candidate identity detects changed content and a non-current candidate schema", () => {
  const analysis = createAnalysis();
  const original = createDossier();
  const brief = createBrief(analysis, original);
  expectReason(() => {
    createValidator().validate(brief, createContext(analysis, createDossier("Changed role")));
  }, ApplicationBriefContextValidationError.REASON.STALE_INPUT);

  const staleSchema = Object.create(CandidateDossier.prototype);
  Object.assign(staleSchema, original.toJson(), { schemaVersion: "candidate-dossier-schema-v2" });
  expectReason(() => {
    createValidator().validate(brief, createContext(analysis, staleSchema));
  }, ApplicationBriefContextValidationError.REASON.STALE_INPUT);
});

test("every offer identity divergence and malformed authority is stale", () => {
  const analysis = createAnalysis();
  const dossier = createDossier();
  const brief = createBrief(analysis, dossier);
  const changes = [
    { offerId: OFFER_ID + 1 },
    { analysisFingerprint: "b".repeat(ApplicationBriefLimits.SHA256_HEX_LENGTH) },
    { analysisSchemaVersion: "offer-analysis-schema-v2" },
    { analyzerPolicyVersion: "offer-analyzer-v2" },
  ];
  for (const change of changes) {
    expectReason(() => {
      createValidator().validate(
        brief,
        createContext(analysis, dossier, createOfferIdentity(change)),
      );
    }, ApplicationBriefContextValidationError.REASON.STALE_INPUT);
  }
  expectReason(() => {
    createValidator().validate(
      brief,
      createContext(analysis, dossier, { ...createOfferIdentity(), unknown: true }),
    );
  }, ApplicationBriefContextValidationError.REASON.STALE_INPUT);
});

test("evidence facts require exact strings whitespace case and booleans", () => {
  const analysis = createAnalysis();
  const dossier = createDossier();
  const base = createBrief(analysis, dossier);
  base.requirementMatches[0] = {
    offerRef: { kind: "REQUIREMENT", index: 0 }, state: "SUPPORTED",
    supportedFacets: [{
      text: "React",
      evidenceRefs: [{ kind: "EXPERIENCE", itemId: "experience-1", field: "role" }],
    }], notEvidencedFacets: [],
  };
  base.evidenceFacts = [{
    ref: { kind: "EXPERIENCE", itemId: "experience-1", field: "role" },
    value: "React Engineer",
  }];
  assert.doesNotThrow(() => {
    createValidator().validate(base, createContext(analysis, dossier));
  });
  for (const value of ["react Engineer", "React Engineer "]) {
    const changed = structuredClone(base);
    changed.evidenceFacts[0].value = value;
    expectReason(() => {
      createValidator().validate(changed, createContext(analysis, dossier));
    }, ApplicationBriefContextValidationError.REASON.EVIDENCE_VALUE_MISMATCH);
  }

  const booleanBrief = createBrief(analysis, dossier);
  booleanBrief.emphasis = [{
    priority: "PRIMARY", offerRefs: [{ kind: "ACTIVITY", index: 0 }],
    evidenceRefs: [{ kind: "EXPERIENCE", itemId: "experience-1", field: "current" }],
    relevanceReason: "Relevant",
  }];
  booleanBrief.evidenceFacts = [{
    ref: { kind: "EXPERIENCE", itemId: "experience-1", field: "current" }, value: true,
  }];
  assert.doesNotThrow(() => {
    createValidator().validate(booleanBrief, createContext(analysis, dossier));
  });
  booleanBrief.evidenceFacts[0].value = false;
  expectReason(() => {
    createValidator().validate(booleanBrief, createContext(analysis, dossier));
  }, ApplicationBriefContextValidationError.REASON.EVIDENCE_VALUE_MISMATCH);
});

test("facets use exact case whitespace and Unicode-sensitive substrings", () => {
  const analysis = createAnalysis();
  const dossier = createDossier();
  for (const text of ["React", "5 ans"]) {
    const brief = createBrief(analysis, dossier);
    brief.requirementMatches[0].notEvidencedFacets = [{ text }];
    assert.doesNotThrow(() => {
      createValidator().validate(brief, createContext(analysis, dossier));
    });
  }
  for (const text of ["react", "React ", "Vue"]) {
    const brief = createBrief(analysis, dossier);
    brief.requirementMatches[0].notEvidencedFacets = [{ text }];
    expectReason(() => {
      createValidator().validate(brief, createContext(analysis, dossier));
    }, ApplicationBriefContextValidationError.REASON.FACET_NOT_IN_REQUIREMENT);
  }
});

test("requirement coverage is exact and empty requirements require empty matches", () => {
  const analysis = createAnalysis();
  const dossier = createDossier();
  const complete = createBrief(analysis, dossier);
  assert.doesNotThrow(() => {
    createValidator().validate(complete, createContext(analysis, dossier));
  });
  const missing = structuredClone(complete);
  missing.requirementMatches.splice(1, 1);
  expectReason(() => {
    createValidator().validate(missing, createContext(analysis, dossier));
  }, ApplicationBriefContextValidationError.REASON.INCOMPLETE_REQUIREMENT_COVERAGE);

  const emptyAnalysis = createAnalysis({ requirements: [] });
  const emptyBrief = createBrief(emptyAnalysis, dossier);
  emptyBrief.emphasis = [{
    priority: "PRIMARY", offerRefs: [{ kind: "ACTIVITY", index: 0 }],
    evidenceRefs: [{ kind: "EXPERIENCE", itemId: "experience-1", field: "role" }],
    relevanceReason: "Relevant",
  }];
  emptyBrief.evidenceFacts = [{
    ref: { kind: "EXPERIENCE", itemId: "experience-1", field: "role" },
    value: "React Engineer",
  }];
  assert.doesNotThrow(() => {
    createValidator().validate(emptyBrief, createContext(emptyAnalysis, dossier));
  });
});

test("requirement coverage rejects a correct cardinality with an incorrect index set", () => {
  const requirements = createAnalysis().toJson().requirements;
  requirements.push({
    category: "SKILL", value: "Node.js", importance: "REQUIRED",
    assertion: "EXPLICIT", evidence: { text: "Node.js" },
  });
  const analysis = createAnalysis({ requirements });
  const dossier = createDossier();
  const brief = createBrief(analysis, dossier);
  brief.requirementMatches.at(-1).offerRef.index = analysis.requirements.length;

  assert.equal(brief.requirementMatches.length, analysis.requirements.length);
  assert.deepEqual(brief.requirementMatches.map((match) => {
    return match.offerRef.index;
  }), [0, 1, analysis.requirements.length]);
  expectReason(() => {
    createValidator().validate(brief, createContext(analysis, dossier));
  }, ApplicationBriefContextValidationError.REASON.INCOMPLETE_REQUIREMENT_COVERAGE);
});

test("empty candidate never causes automatic matching and missing coverage still fails", () => {
  const analysis = createAnalysis();
  const dossier = CandidateDossier.empty();
  const brief = createBrief(analysis, dossier);
  brief.requirementMatches = [];
  expectReason(() => {
    createValidator().validate(brief, createContext(analysis, dossier));
  }, ApplicationBriefContextValidationError.REASON.INCOMPLETE_REQUIREMENT_COVERAGE);

  const notEvidenced = createBrief(analysis, dossier);
  assert.doesNotThrow(() => {
    createValidator().validate(notEvidenced, createContext(analysis, dossier));
  });
});

test("out-of-range OfferRefs fail in emphasis supported claims and cautions", () => {
  const analysis = createAnalysis();
  const dossier = createDossier();
  const fact = {
    ref: { kind: "EXPERIENCE", itemId: "experience-1", field: "role" },
    value: "React Engineer",
  };
  const invalidRef = { kind: "ACTIVITY", index: analysis.activities.length };
  const items = [
    ["emphasis", {
      priority: "PRIMARY", offerRefs: [invalidRef], evidenceRefs: [fact.ref],
      relevanceReason: "Relevant",
    }],
    ["supportedClaims", {
      claimType: "EXPERIENCE_FACT", offerRefs: [invalidRef], evidenceRefs: [fact.ref],
    }],
    ["cautions", {
      kind: "DURATION_UNSUPPORTED", offerRefs: [invalidRef], evidenceRefs: [fact.ref],
    }],
  ];
  for (const [collection, item] of items) {
    const brief = createBrief(analysis, dossier);
    brief[collection] = [item];
    brief.evidenceFacts = [fact];
    expectReason(() => {
      createValidator().validate(brief, createContext(analysis, dossier));
    }, ApplicationBriefContextValidationError.REASON.INVALID_OFFER_REFERENCE);
  }
});

test("context error exposes only its exact closed taxonomy", () => {
  assert.deepEqual(Object.values(ApplicationBriefContextValidationError.REASON), [
    "INVALID_OFFER_REFERENCE", "INVALID_EVIDENCE_REFERENCE", "EVIDENCE_VALUE_MISMATCH",
    "FACET_NOT_IN_REQUIREMENT", "INCOMPLETE_REQUIREMENT_COVERAGE", "STALE_INPUT",
  ]);
  assert.throws(() => {
    new ApplicationBriefContextValidationError("UNKNOWN");
  }, TypeError);
});
