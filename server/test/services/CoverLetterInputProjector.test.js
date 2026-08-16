import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationBriefLimits } from "../../src/constants/ApplicationBriefLimits.js";
import { ApplicationBrief } from "../../src/models/ApplicationBrief.js";
import { OfferAnalysis } from "../../src/models/OfferAnalysis.js";
import { ApplicationBriefOfferRefResolver } from "../../src/services/ApplicationBriefOfferRefResolver.js";
import { ApplicationBriefValidator } from "../../src/services/ApplicationBriefValidator.js";
import { CoverLetterInputProjector } from "../../src/services/CoverLetterInputProjector.js";

const SECOND_INDEX = 1;

const REFERENCES = Object.freeze({
  experienceRole: Object.freeze({ kind: "EXPERIENCE", itemId: "same", field: "role" }),
  experienceActivity: Object.freeze({
    kind: "EXPERIENCE", itemId: "same", field: "activities[0]",
  }),
  experienceAchievement: Object.freeze({
    kind: "EXPERIENCE", itemId: "same", field: "achievements[0]",
  }),
  experienceTechnology: Object.freeze({
    kind: "EXPERIENCE", itemId: "same", field: "technologies[0]",
  }),
  experienceCurrent: Object.freeze({ kind: "EXPERIENCE", itemId: "same", field: "current" }),
  projectName: Object.freeze({ kind: "PROJECT", itemId: "same", field: "name" }),
  skill: Object.freeze({ kind: "SKILL", itemId: "skill-1", field: "value" }),
  education: Object.freeze({ kind: "EDUCATION", itemId: "education-1", field: "field" }),
  language: Object.freeze({ kind: "LANGUAGE", itemId: "language-1", field: "speaking" }),
  softSkill: Object.freeze({ kind: "SOFT_SKILL", itemId: "soft-1", field: "value" }),
  unused: Object.freeze({ kind: "SKILL", itemId: "unused", field: "detail" }),
});

/**
 * Create the deterministic projector with the production offer resolver.
 * @returns {CoverLetterInputProjector} Projector fixture.
 */
function createProjector() {
  return new CoverLetterInputProjector({
    offerRefResolver: new ApplicationBriefOfferRefResolver(),
  });
}

/**
 * Create one authoritative analysis covering every offer reference kind.
 * @param {object} [overrides] - Analysis root overrides.
 * @returns {OfferAnalysis} Offer analysis fixture.
 */
function createAnalysis(overrides = {}) {
  return new OfferAnalysis({
    seniority: {
      levels: ["SENIOR", "LEAD"], assertion: "EXPLICIT", evidence: { text: "Senior or lead" },
    },
    activities: [{ value: "Build the platform", assertion: "EXPLICIT", evidence: null }],
    requirements: [{
      category: "EXPERIENCE", value: "React, TypeScript et 5 ans d'expérience",
      importance: "REQUIRED", assertion: "EXPLICIT", evidence: null,
    }, {
      category: "TOOL_OR_TECHNOLOGY", value: "React et Kubernetes",
      importance: "REQUIRED", assertion: "EXPLICIT", evidence: null,
    }],
    context: [{ category: "DOMAIN", value: "Healthcare", assertion: "INFERRED", evidence: null }],
    workConditions: {
      workMode: { mode: "REMOTE", detail: null, assertion: "EXPLICIT", evidence: null },
      constraints: [{
        category: "TRAVEL", value: "Travel weekly", assertion: "EXPLICIT", evidence: null,
      }],
    },
    ...overrides,
  });
}

/**
 * Build one complete brief value with supported, partial and negative boundaries.
 * @param {object} [overrides] - Brief root overrides.
 * @param {boolean} [validate] - Whether to apply the real structural validator.
 * @returns {ApplicationBrief} Immutable brief fixture.
 */
function createBrief(overrides = {}, validate = true) {
  const availableFacts = [
    [REFERENCES.experienceRole, "Software engineer"],
    [REFERENCES.experienceActivity, "Built React interfaces"],
    [REFERENCES.experienceAchievement, "Reduced incidents"],
    [REFERENCES.experienceTechnology, "React"],
    [REFERENCES.experienceCurrent, false],
    [REFERENCES.projectName, "Health platform"],
    [REFERENCES.skill, "React"],
    [REFERENCES.education, "Computer science"],
    [REFERENCES.language, "Fluent"],
    [REFERENCES.softSkill, "Communication"],
    [REFERENCES.unused, "Must not be projected"],
  ].map(([ref, value]) => {
    return { ref, value };
  });
  const value = {
    schemaVersion: "application-brief-schema-v1",
    inputIdentity: {
      offer: {
        offerId: 1,
        analysisFingerprint: "a".repeat(ApplicationBriefLimits.SHA256_HEX_LENGTH),
        analysisSchemaVersion: "offer-analysis-schema-v1",
        analyzerPolicyVersion: "offer-analyzer-v1",
      },
      candidate: {
        fingerprint: "b".repeat(ApplicationBriefLimits.SHA256_HEX_LENGTH),
        schemaVersion: "candidate-dossier-schema-v1",
      },
    },
    requirementMatches: [{
      offerRef: { kind: "REQUIREMENT", index: 0 }, state: "SUPPORTED",
      supportedFacets: [{ text: "React", evidenceRefs: [REFERENCES.skill] }],
      notEvidencedFacets: [],
    }, {
      offerRef: { kind: "REQUIREMENT", index: SECOND_INDEX }, state: "PARTIALLY_SUPPORTED",
      supportedFacets: [{ text: "React", evidenceRefs: [REFERENCES.skill] }],
      notEvidencedFacets: [{ text: "Kubernetes" }],
    }],
    evidenceFacts: [],
    emphasis: [{
      priority: "PRIMARY", offerRefs: [{ kind: "REQUIREMENT", index: 0 }],
      evidenceRefs: [REFERENCES.skill], relevanceReason: "Lead with verified React expertise",
    }],
    supportedClaims: [{
      claimType: "SKILL_DECLARATION", offerRefs: [{ kind: "REQUIREMENT", index: 0 }],
      evidenceRefs: [REFERENCES.skill],
    }, {
      claimType: "SKILL_DECLARATION",
      offerRefs: [{ kind: "REQUIREMENT", index: SECOND_INDEX }],
      evidenceRefs: [REFERENCES.skill],
    }],
    cautions: [{
      kind: "DURATION_UNSUPPORTED", offerRefs: [{ kind: "REQUIREMENT", index: 0 }],
      evidenceRefs: [REFERENCES.skill, REFERENCES.unused],
    }],
    ...overrides,
  };
  if (overrides.evidenceFacts === undefined) {
    const usedKeys = new Set();
    for (const match of value.requirementMatches) {
      for (const facet of match.supportedFacets) {
        for (const reference of facet.evidenceRefs) {
          usedKeys.add(JSON.stringify(reference));
        }
      }
    }
    for (const item of [...value.emphasis, ...value.supportedClaims, ...value.cautions]) {
      for (const reference of item.evidenceRefs) {
        usedKeys.add(JSON.stringify(reference));
      }
    }
    value.evidenceFacts = availableFacts.filter((fact) => {
      return usedKeys.has(JSON.stringify(fact.ref));
    });
  }
  return validate ? new ApplicationBriefValidator().validate(value) : new ApplicationBrief(value);
}

/**
 * Collect every object key recursively without inspecting scalar values.
 * @param {unknown} value - JSON-compatible projected value.
 * @param {Set<string>} [keys] - Accumulated key names.
 * @returns {Set<string>} Every recursively observed object key.
 */
function collectObjectKeys(value, keys = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectObjectKeys(item, keys);
    }
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collectObjectKeys(child, keys);
    }
  }
  return keys;
}

/**
 * Create the minimal authoritative snapshot used by letter generation.
 * @param {object} [overrides] - Snapshot overrides.
 * @returns {object} Offer snapshot fixture.
 */
function createSnapshot(overrides = {}) {
  return {
    offerId: 1, source: "provider", title: "Senior Engineer", company: { name: "Example" },
    location: { city: "Paris" }, contract: { type: "CDI" }, salary: { raw: "High" },
    ...overrides,
  };
}

/**
 * Project one fixture set with optional overrides.
 * @param {object} [inputs] - Input overrides.
 * @returns {object} Cover-letter input projection.
 */
function project(inputs = {}) {
  return createProjector().project({
    applicationBrief: inputs.applicationBrief ?? createBrief(),
    offerAnalysis: inputs.offerAnalysis ?? createAnalysis(),
    offerSnapshot: inputs.offerSnapshot ?? createSnapshot(),
  });
}

test("projection has the exact minimal root and authoritative offer metadata", () => {
  const output = project();

  assert.deepEqual(Object.keys(output), ["offer", "claims", "boundaries"]);
  assert.deepEqual(output.offer, { title: "Senior Engineer", company: "Example" });
  assert.equal(JSON.stringify(output).includes("Paris"), false);
  assert.equal(JSON.stringify(output).includes("CDI"), false);
  assert.equal(JSON.stringify(output).includes("High"), false);
  assert.equal(JSON.stringify(output).includes("Travel weekly"), false);
});

test("primary projector fixture passes the real ApplicationBrief structural validator", () => {
  const brief = createBrief();

  assert.equal(brief instanceof ApplicationBrief, true);
  assert.doesNotThrow(() => {
    new ApplicationBriefValidator().validate(brief.toJson());
  });
});

test("missing company becomes null and missing or invalid title fails closed", () => {
  assert.deepEqual(project({ offerSnapshot: createSnapshot({ company: null }) }).offer, {
    title: "Senior Engineer", company: null,
  });
  assert.throws(() => {
    project({ offerSnapshot: createSnapshot({ title: null }) });
  }, TypeError);
  assert.throws(() => {
    project({ offerSnapshot: createSnapshot({ company: { name: "" } }) });
  }, TypeError);
});

test("supported claims alone define stable original claim indexes and types", () => {
  const claims = [
    ["EXPERIENCE_FACT", REFERENCES.experienceRole, "experience"],
    ["PROJECT_FACT", REFERENCES.projectName, "project"],
    ["SKILL_DECLARATION", REFERENCES.skill, "skill"],
    ["EDUCATION_FACT", REFERENCES.education, "education"],
    ["LANGUAGE_DECLARATION", REFERENCES.language, "language"],
    ["SOFT_SKILL_DECLARATION", REFERENCES.softSkill, "softSkill"],
  ].map(([claimType, reference]) => {
    return {
      claimType, offerRefs: [{ kind: "ACTIVITY", index: 0 }], evidenceRefs: [reference],
    };
  });
  const output = project({ applicationBrief: createBrief({ supportedClaims: claims, emphasis: [] }) });

  assert.deepEqual(output.claims.map((claim) => {
    return [claim.index, claim.type];
  }), claims.map((claim, index) => {
    return [index, CLAIM_TYPE_FOR_TEST[claim.claimType]];
  }));
});

const CLAIM_TYPE_FOR_TEST = Object.freeze({
  EXPERIENCE_FACT: "experience", PROJECT_FACT: "project", SKILL_DECLARATION: "skill",
  EDUCATION_FACT: "education", LANGUAGE_DECLARATION: "language",
  SOFT_SKILL_DECLARATION: "softSkill",
});

test("candidate evidence maps all source and indexed-field vocabularies", () => {
  const references = [
    REFERENCES.experienceRole, REFERENCES.experienceActivity, REFERENCES.experienceAchievement,
    REFERENCES.experienceTechnology, REFERENCES.experienceCurrent,
  ];
  const brief = createBrief({
    supportedClaims: [{
      claimType: "EXPERIENCE_FACT", offerRefs: [{ kind: "ACTIVITY", index: 0 }],
      evidenceRefs: references,
    }],
    emphasis: [],
  });
  const [evidence] = project({ applicationBrief: brief }).claims[0].candidateEvidence;

  assert.equal(evidence.source, "experience");
  assert.deepEqual(evidence.facts.map((fact) => {
    return fact.attribute;
  }), ["role", "activity", "achievement", "technology", "current"]);
  assert.equal(evidence.facts.at(-1).value, false);
});

test("evidence grouping uses kind and item identity but never exposes itemId", () => {
  const brief = createBrief({
    supportedClaims: [{
      claimType: "EXPERIENCE_FACT", offerRefs: [{ kind: "ACTIVITY", index: 0 }],
      evidenceRefs: [REFERENCES.experienceRole, REFERENCES.experienceCurrent],
    }, {
      claimType: "PROJECT_FACT", offerRefs: [{ kind: "ACTIVITY", index: 0 }],
      evidenceRefs: [REFERENCES.projectName],
    }],
    emphasis: [],
  });
  const output = project({ applicationBrief: brief });

  assert.equal(output.claims[0].candidateEvidence.length, 1);
  assert.equal(output.claims[0].candidateEvidence[0].facts.length, SECOND_INDEX + 1);
  assert.equal(output.claims[SECOND_INDEX].candidateEvidence[0].source, "project");
  assert.equal(Object.hasOwn(output.claims[0].candidateEvidence[0], "itemId"), false);
});

test("only claim-referenced facts are projected and unresolved facts fail closed", () => {
  const serialized = JSON.stringify(project());
  assert.equal(serialized.includes("Must not be projected"), false);
  const brief = createBrief({
    supportedClaims: [{
      claimType: "SKILL_DECLARATION", offerRefs: [{ kind: "ACTIVITY", index: 0 }],
      evidenceRefs: [{ kind: "SKILL", itemId: "missing", field: "value" }],
    }],
  }, false);
  assert.throws(() => {
    project({ applicationBrief: brief });
  }, /unresolved/u);
});

test("supported requirement exposes facets and never the complete requirement", () => {
  const output = project();
  assert.deepEqual(output.claims[0].relatedOfferElements, [
    { type: "requirement", value: "React" },
  ]);
  assert.equal(JSON.stringify(output.claims[0]).includes("TypeScript"), false);
  assert.equal(JSON.stringify(output.claims[0]).includes("5 ans"), false);
});

test("partial requirement keeps React positive and Kubernetes only negative", () => {
  const output = project();
  const claim = output.claims[SECOND_INDEX];

  assert.deepEqual(claim.relatedOfferElements, [{ type: "requirement", value: "React" }]);
  assert.equal(JSON.stringify(claim).includes("Kubernetes"), false);
  assert.deepEqual(output.boundaries.partialRequirements, [{
    supportedFacets: ["React"], notEvidencedFacets: ["Kubernetes"],
  }]);
});

test("not-evidenced requirement cannot support a positive claim", () => {
  const match = {
    offerRef: { kind: "REQUIREMENT", index: 0 }, state: "NOT_EVIDENCED",
    supportedFacets: [], notEvidencedFacets: [{ text: "React" }],
  };
  const brief = createBrief({ requirementMatches: [match] });
  assert.throws(() => {
    project({ applicationBrief: brief });
  }, /cannot support/u);
});

test("missing requirement match and unresolved offer refs fail closed", () => {
  const brief = createBrief({ requirementMatches: [] });
  assert.throws(() => {
    project({ applicationBrief: brief });
  }, /missing/u);
  const invalidOfferBrief = createBrief({
    supportedClaims: [{
      claimType: "SKILL_DECLARATION", offerRefs: [{ kind: "ACTIVITY", index: SECOND_INDEX }],
      evidenceRefs: [REFERENCES.skill],
    }],
  });
  assert.throws(() => {
    project({ applicationBrief: invalidOfferBrief });
  });
  const invalidCautionBrief = createBrief({
    cautions: [{
      kind: "DURATION_UNSUPPORTED", offerRefs: [{ kind: "CONTEXT", index: SECOND_INDEX }],
      evidenceRefs: [REFERENCES.skill],
    }],
  });
  assert.throws(() => {
    project({ applicationBrief: invalidCautionBrief });
  });
});

test("activity and context are offer context only and never candidate evidence", () => {
  const brief = createBrief({
    supportedClaims: [{
      claimType: "SKILL_DECLARATION",
      offerRefs: [{ kind: "ACTIVITY", index: 0 }, { kind: "CONTEXT", index: 0 }],
      evidenceRefs: [REFERENCES.skill],
    }],
    emphasis: [],
  });
  const claim = project({ applicationBrief: brief }).claims[0];

  assert.deepEqual(claim.relatedOfferElements, [
    { type: "activity", value: "Build the platform" },
    { type: "context", value: "Healthcare" },
  ]);
  assert.equal(JSON.stringify(claim.candidateEvidence).includes("Build the platform"), false);
  assert.equal(JSON.stringify(claim.candidateEvidence).includes("Healthcare"), false);
});

test("seniority projects only closed factual levels without evidence text", () => {
  const brief = createBrief({
    supportedClaims: [{
      claimType: "SKILL_DECLARATION", offerRefs: [{ kind: "SENIORITY" }],
      evidenceRefs: [REFERENCES.skill],
    }],
    emphasis: [],
  });
  const claim = project({ applicationBrief: brief }).claims[0];

  assert.deepEqual(claim.relatedOfferElements, [
    { type: "seniority", value: "senior" }, { type: "seniority", value: "lead" },
  ]);
  assert.equal(JSON.stringify(claim).includes("Senior or lead"), false);
});

test("emphasis maps primary secondary none and ignores reference order", () => {
  const offerRefs = [{ kind: "ACTIVITY", index: 0 }, { kind: "CONTEXT", index: 0 }];
  const evidenceRefs = [REFERENCES.experienceRole, REFERENCES.experienceCurrent];
  const claims = [{ claimType: "EXPERIENCE_FACT", offerRefs, evidenceRefs }];
  const secondary = {
    priority: "SECONDARY", offerRefs: [...offerRefs].reverse(),
    evidenceRefs: [...evidenceRefs].reverse(), relevanceReason: "Secondary reason",
  };
  const primary = { ...secondary, priority: "PRIMARY", relevanceReason: "Primary reason" };
  const primaryOutput = project({
    applicationBrief: createBrief({ supportedClaims: claims, emphasis: [secondary, primary] }),
  });
  const secondaryOutput = project({
    applicationBrief: createBrief({ supportedClaims: claims, emphasis: [secondary] }),
  });
  const noneOutput = project({
    applicationBrief: createBrief({ supportedClaims: claims, emphasis: [] }),
  });

  assert.equal(primaryOutput.claims[0].priority, "primary");
  assert.equal(primaryOutput.claims[0].strategyReason, "Primary reason");
  assert.equal(secondaryOutput.claims[0].priority, "secondary");
  assert.deepEqual(
    [noneOutput.claims[0].priority, noneOutput.claims[0].strategyReason],
    [null, null],
  );
});

test("one superset emphasis applies to each covered claim", () => {
  const firstOfferRef = { kind: "REQUIREMENT", index: 0 };
  const secondOfferRef = { kind: "REQUIREMENT", index: SECOND_INDEX };
  const supportedClaims = [{
    claimType: "SKILL_DECLARATION", offerRefs: [firstOfferRef],
    evidenceRefs: [REFERENCES.skill],
  }, {
    claimType: "SKILL_DECLARATION", offerRefs: [secondOfferRef],
    evidenceRefs: [REFERENCES.unused],
  }];
  const emphasis = [{
    priority: "PRIMARY", offerRefs: [firstOfferRef, secondOfferRef],
    evidenceRefs: [REFERENCES.skill, REFERENCES.unused],
    relevanceReason: "Combined verified strengths",
  }];
  const claims = project({
    applicationBrief: createBrief({ supportedClaims, emphasis, cautions: [] }),
  }).claims;

  assert.deepEqual(claims.map((claim) => {
    return [claim.priority, claim.strategyReason];
  }), [
    ["primary", "Combined verified strengths"],
    ["primary", "Combined verified strengths"],
  ]);
});

test("subset emphasis applies through one shared offer and evidence ref", () => {
  const supportedClaims = [{
    claimType: "EXPERIENCE_FACT",
    offerRefs: [{ kind: "ACTIVITY", index: 0 }, { kind: "CONTEXT", index: 0 }],
    evidenceRefs: [REFERENCES.experienceRole, REFERENCES.experienceCurrent],
  }];
  const emphasis = [{
    priority: "SECONDARY", offerRefs: [{ kind: "ACTIVITY", index: 0 }],
    evidenceRefs: [REFERENCES.experienceRole], relevanceReason: "Focused experience angle",
  }];
  const [claim] = project({
    applicationBrief: createBrief({ supportedClaims, emphasis, cautions: [] }),
  }).claims;

  assert.equal(claim.priority, "secondary");
  assert.equal(claim.strategyReason, "Focused experience angle");
});

test("emphasis requires both shared offer and shared evidence refs", () => {
  const supportedClaims = [{
    claimType: "SKILL_DECLARATION", offerRefs: [{ kind: "ACTIVITY", index: 0 }],
    evidenceRefs: [REFERENCES.skill],
  }];
  const emphasis = [{
    priority: "PRIMARY", offerRefs: [{ kind: "CONTEXT", index: 0 }],
    evidenceRefs: [REFERENCES.skill], relevanceReason: "Evidence overlap only",
  }, {
    priority: "PRIMARY", offerRefs: [{ kind: "ACTIVITY", index: 0 }],
    evidenceRefs: [REFERENCES.unused], relevanceReason: "Offer overlap only",
  }, {
    priority: "PRIMARY", offerRefs: [{ kind: "CONTEXT", index: 0 }],
    evidenceRefs: [REFERENCES.unused], relevanceReason: "No overlap",
  }];
  const [claim] = project({
    applicationBrief: createBrief({ supportedClaims, emphasis, cautions: [] }),
  }).claims;

  assert.equal(claim.priority, null);
  assert.equal(claim.strategyReason, null);
});

test("same-priority emphasis with distinct reasons fails as ambiguous", () => {
  const offerRefs = [{ kind: "ACTIVITY", index: 0 }];
  const evidenceRefs = [REFERENCES.skill];
  const supportedClaims = [{ claimType: "SKILL_DECLARATION", offerRefs, evidenceRefs }];
  const emphasis = ["First", "Second"].map((relevanceReason) => {
    return { priority: "PRIMARY", offerRefs, evidenceRefs, relevanceReason };
  });
  assert.throws(() => {
    project({ applicationBrief: createBrief({ supportedClaims, emphasis }) });
  }, /ambiguous/u);
});

test("all five cautions survive with strict related and global indexes", () => {
  const kinds = [
    "EXPERTISE_LEVEL_UNSUPPORTED", "DURATION_UNSUPPORTED", "LEADERSHIP_UNSUPPORTED",
    "LANGUAGE_LEVEL_UNSUPPORTED", "SCOPE_GENERALIZATION_UNSUPPORTED",
  ];
  const cautions = kinds.map((kind, index) => {
    return {
      kind,
      offerRefs: [{ kind: index === 0 ? "ACTIVITY" : "CONTEXT", index: 0 }],
      evidenceRefs: [index === 0 ? REFERENCES.skill : REFERENCES.experienceRole],
    };
  });
  const brief = createBrief({
    supportedClaims: [{
      claimType: "SKILL_DECLARATION", offerRefs: [{ kind: "ACTIVITY", index: 0 }],
      evidenceRefs: [REFERENCES.skill],
    }],
    emphasis: [], cautions,
  });
  const projected = project({ applicationBrief: brief }).boundaries.cautions;

  assert.deepEqual(projected.map((caution) => {
    return caution.type;
  }), ["expertiseLevel", "duration", "leadership", "languageLevel", "scopeGeneralization"]);
  assert.deepEqual(projected[0].relatedClaimIndexes, [0]);
  assert.deepEqual(projected[SECOND_INDEX].relatedClaimIndexes, []);
});

test("not-evidenced facets are global boundaries without candidate weakness wording", () => {
  const brief = createBrief({
    requirementMatches: [{
      offerRef: { kind: "REQUIREMENT", index: 0 }, state: "NOT_EVIDENCED",
      supportedFacets: [], notEvidencedFacets: [{ text: "Kubernetes" }, { text: "Five years" }],
    }],
    supportedClaims: [], emphasis: [], cautions: [],
  });
  const output = project({ applicationBrief: brief });

  assert.deepEqual(output.boundaries.notEvidencedFacets, ["Kubernetes", "Five years"]);
  assert.deepEqual(output.claims, []);
});

test("empty claims requirements emphasis and cautions produce clean arrays", () => {
  const brief = createBrief({
    requirementMatches: [], supportedClaims: [], emphasis: [], cautions: [], evidenceFacts: [],
  });
  const analysis = createAnalysis({ requirements: [] });
  const output = project({ applicationBrief: brief, offerAnalysis: analysis });

  assert.deepEqual(output, {
    offer: { title: "Senior Engineer", company: "Example" },
    claims: [],
    boundaries: { partialRequirements: [], notEvidencedFacets: [], cautions: [] },
  });
});

test("projection is deterministic detached and never mutates any input", () => {
  const applicationBrief = createBrief();
  const offerAnalysis = createAnalysis();
  const offerSnapshot = createSnapshot();
  const briefBefore = applicationBrief.toJson();
  const analysisBefore = offerAnalysis.toJson();
  const snapshotBefore = structuredClone(offerSnapshot);
  const first = project({ applicationBrief, offerAnalysis, offerSnapshot });
  const second = project({ applicationBrief, offerAnalysis, offerSnapshot });

  assert.deepEqual(first, second);
  first.offer.title = "Changed";
  first.claims[0].candidateEvidence[0].facts[0].value = "Changed";
  first.boundaries.partialRequirements[0].supportedFacets.push("Changed");
  assert.deepEqual(applicationBrief.toJson(), briefBefore);
  assert.deepEqual(offerAnalysis.toJson(), analysisBefore);
  assert.deepEqual(offerSnapshot, snapshotBefore);
});

test("projection structure excludes technical refs and metadata keys", () => {
  const output = project({
    offerSnapshot: createSnapshot({ company: { name: "model field ref" } }),
  });
  const keys = collectObjectKeys(output);
  const forbidden = [
    "itemId", "field", "ref", "evidenceRefs", "offerRefs", "inputIdentity",
    "analysisFingerprint", "schemaVersion", "analyzerPolicyVersion", "policyVersion",
    "offerId", "assertion", "importance", "provider", "model",
  ];

  for (const key of forbidden) {
    assert.equal(keys.has(key), false);
  }
  assert.doesNotThrow(() => {
    JSON.parse(JSON.stringify(output));
  });
});

test("projector requires its deterministic offer resolver", () => {
  assert.throws(() => {
    new CoverLetterInputProjector({ offerRefResolver: null });
  }, TypeError);
});
