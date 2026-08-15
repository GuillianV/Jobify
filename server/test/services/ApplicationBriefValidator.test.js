import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationBriefConstants } from "../../src/constants/ApplicationBriefConstants.js";
import { ApplicationBriefLimits } from "../../src/constants/ApplicationBriefLimits.js";
import { CandidateDossierLimits } from "../../src/constants/CandidateDossierLimits.js";
import { ApplicationBrief } from "../../src/models/ApplicationBrief.js";
import { ApplicationBriefValidationError } from "../../src/services/ApplicationBriefValidationError.js";
import { ApplicationBriefValidator } from "../../src/services/ApplicationBriefValidator.js";

const EVIDENCE_REF = Object.freeze({ kind: "EXPERIENCE", itemId: "exp-1", field: "role" });
const OFFER_REF = Object.freeze({ kind: "REQUIREMENT", index: 0 });

/**
 * Build one complete empty brief.
 * @returns {object} Valid empty brief.
 */
function createEmptyBrief() {
  return {
    schemaVersion: ApplicationBriefConstants.SCHEMA_VERSION,
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
    requirementMatches: [],
    evidenceFacts: [],
    emphasis: [],
    supportedClaims: [],
    cautions: [],
  };
}

/**
 * Build one supported requirement match.
 * @returns {object} Valid supported match.
 */
function createSupportedMatch() {
  return {
    offerRef: { ...OFFER_REF },
    state: "SUPPORTED",
    supportedFacets: [{ text: "Requirement fragment", evidenceRefs: [{ ...EVIDENCE_REF }] }],
    notEvidencedFacets: [],
  };
}

/**
 * Add exactly the evidence facts used by one candidate brief.
 * @param {object} brief - Brief to complete.
 * @returns {object} Same brief.
 */
function addEvidenceFacts(brief) {
  const references = [];
  for (const match of brief.requirementMatches) {
    for (const facet of match.supportedFacets) {
      references.push(...facet.evidenceRefs);
    }
  }
  for (const item of [...brief.emphasis, ...brief.supportedClaims, ...brief.cautions]) {
    references.push(...item.evidenceRefs);
  }
  const unique = new Map();
  for (const reference of references) {
    unique.set(JSON.stringify(reference), reference);
  }
  brief.evidenceFacts = [...unique.values()].map((reference) => {
    return { ref: structuredClone(reference), value: reference.field === "current" ? true : "Value" };
  });
  return brief;
}

/**
 * Build a requested number of structurally unique evidence references.
 * @param {number} count - Number of references.
 * @param {string} [kind] - Evidence kind.
 * @param {string} [field] - Evidence field.
 * @returns {object[]} Unique evidence references.
 */
function createEvidenceRefs(count, kind = "SKILL", field = "value") {
  return Array.from({ length: count }, (_, index) => {
    return { kind, itemId: `item-${index}`, field };
  });
}

/**
 * Build a requested number of structurally unique indexed offer references.
 * @param {number} count - Number of references.
 * @returns {object[]} Unique requirement references.
 */
function createOfferRefs(count) {
  return Array.from({ length: count }, (_, index) => {
    return { kind: "REQUIREMENT", index };
  });
}

/**
 * Assert one brief candidate fails with the closed validation error.
 * @param {unknown} candidate - Invalid brief candidate.
 * @returns {void}
 */
function expectInvalid(candidate) {
  assert.throws(() => {
    new ApplicationBriefValidator().validate(candidate);
  }, (error) => {
    assert.equal(error instanceof ApplicationBriefValidationError, true);
    assert.equal(error.code, "INVALID_APPLICATION_BRIEF");
    return true;
  });
}

test("empty arrays form a valid immutable ApplicationBrief without mutation", () => {
  const input = createEmptyBrief();
  const snapshot = structuredClone(input);
  const result = new ApplicationBriefValidator().validate(input);

  assert.equal(result instanceof ApplicationBrief, true);
  assert.deepEqual(result.toJson(), snapshot);
  assert.deepEqual(input, snapshot);
});

test("representative supported partial and not-evidenced matches are valid", () => {
  const supported = createEmptyBrief();
  supported.requirementMatches = [createSupportedMatch()];
  assert.equal(new ApplicationBriefValidator().validate(addEvidenceFacts(supported)) instanceof ApplicationBrief, true);

  const partial = createEmptyBrief();
  partial.requirementMatches = [{
    ...createSupportedMatch(), state: "PARTIALLY_SUPPORTED",
    notEvidencedFacets: [{ text: "Missing fragment" }],
  }];
  assert.equal(new ApplicationBriefValidator().validate(addEvidenceFacts(partial)) instanceof ApplicationBrief, true);

  const missing = createEmptyBrief();
  missing.requirementMatches = [{
    offerRef: { ...OFFER_REF }, state: "NOT_EVIDENCED", supportedFacets: [],
    notEvidencedFacets: [{ text: "Missing fragment" }],
  }];
  assert.equal(new ApplicationBriefValidator().validate(missing) instanceof ApplicationBrief, true);
});

test("root shape schema and input identity are strict", () => {
  for (const mutate of [
    (brief) => {
      delete brief.cautions;
    },
    (brief) => {
      brief.unknown = true;
    },
    (brief) => {
      brief.schemaVersion = "wrong";
    },
    (brief) => {
      brief.inputIdentity = null;
    },
    (brief) => {
      brief.inputIdentity.offer.offerId = "1";
    },
    (brief) => {
      brief.inputIdentity.offer.analysisFingerprint = "A"
        .repeat(ApplicationBriefLimits.SHA256_HEX_LENGTH);
    },
    (brief) => {
      brief.inputIdentity.offer.analysisSchemaVersion = "wrong";
    },
    (brief) => {
      brief.inputIdentity.offer.analyzerPolicyVersion = "";
    },
    (brief) => {
      brief.inputIdentity.candidate.fingerprint = "short";
    },
    (brief) => {
      brief.inputIdentity.candidate.schemaVersion = "wrong";
    },
    (brief) => {
      brief.requirementMatches = null;
    },
  ]) {
    const brief = createEmptyBrief();
    mutate(brief);
    expectInvalid(brief);
  }
});

test("all root arrays enforce their exact maximum", () => {
  const cases = [
    ["requirementMatches", ApplicationBriefLimits.MAX_REQUIREMENT_MATCHES, () => {
      return {
        offerRef: { kind: "REQUIREMENT", index: 0 }, state: "NOT_EVIDENCED",
        supportedFacets: [], notEvidencedFacets: [{ text: "Missing" }],
      };
    }],
    ["evidenceFacts", ApplicationBriefLimits.MAX_EVIDENCE_FACTS, () => {
      return {
        ref: { kind: "SKILL", itemId: "skill-1", field: "value" }, value: "Value",
      };
    }],
    ["emphasis", ApplicationBriefLimits.MAX_EMPHASIS, () => {
      return {
        priority: "PRIMARY", offerRefs: [{ ...OFFER_REF }], evidenceRefs: [{ ...EVIDENCE_REF }],
        relevanceReason: "Relevant",
      };
    }],
    ["supportedClaims", ApplicationBriefLimits.MAX_SUPPORTED_CLAIMS, () => {
      return {
        claimType: "EXPERIENCE_FACT", offerRefs: [{ ...OFFER_REF }],
        evidenceRefs: [{ ...EVIDENCE_REF }],
      };
    }],
    ["cautions", ApplicationBriefLimits.MAX_CAUTIONS, () => {
      return {
        kind: "DURATION_UNSUPPORTED", offerRefs: [{ ...OFFER_REF }],
        evidenceRefs: [{ ...EVIDENCE_REF }],
      };
    }],
  ];
  for (const [field, maximum, factory] of cases) {
    const brief = createEmptyBrief();
    brief[field] = Array.from({ length: maximum + 1 }, (_, index) => {
      const item = factory();
      if (field === "requirementMatches") {
        item.offerRef.index = index;
      } else if (field === "evidenceFacts") {
        item.ref.itemId = `skill-${index}`;
      }
      return item;
    });
    expectInvalid(brief);
  }
});

test("match state facet matrix is enforced exhaustively", () => {
  const cases = [
    ["SUPPORTED", true, false, true],
    ["SUPPORTED", true, true, false],
    ["PARTIALLY_SUPPORTED", true, true, true],
    ["PARTIALLY_SUPPORTED", false, true, false],
    ["PARTIALLY_SUPPORTED", true, false, false],
    ["NOT_EVIDENCED", false, true, true],
    ["NOT_EVIDENCED", true, true, false],
    ["NOT_EVIDENCED", false, false, false],
  ];
  for (const [state, hasSupported, hasMissing, valid] of cases) {
    const brief = createEmptyBrief();
    brief.requirementMatches = [{
      offerRef: { ...OFFER_REF }, state,
      supportedFacets: hasSupported
        ? [{ text: "Supported", evidenceRefs: [{ ...EVIDENCE_REF }] }] : [],
      notEvidencedFacets: hasMissing ? [{ text: "Missing" }] : [],
    }];
    addEvidenceFacts(brief);
    if (valid) {
      assert.equal(new ApplicationBriefValidator().validate(brief) instanceof ApplicationBrief, true);
    } else {
      expectInvalid(brief);
    }
  }
});

test("offer reference kinds and exact shapes are validated", () => {
  const validRefs = [
    { kind: "REQUIREMENT", index: 0 }, { kind: "ACTIVITY", index: 1 },
    { kind: "CONTEXT", index: 2 }, { kind: "SENIORITY" },
  ];
  for (const offerRef of validRefs) {
    const brief = createEmptyBrief();
    brief.emphasis = [{
      priority: "PRIMARY", offerRefs: [offerRef], evidenceRefs: [{ ...EVIDENCE_REF }],
      relevanceReason: "Relevant",
    }];
    assert.equal(new ApplicationBriefValidator().validate(addEvidenceFacts(brief)) instanceof ApplicationBrief, true);
  }
  for (const offerRef of [
    { kind: "REQUIREMENT", index: -1 }, { kind: "ACTIVITY", index: 1.5 },
    { kind: "CONTEXT", index: "1" }, { kind: "SENIORITY", index: 0 },
    { kind: "UNKNOWN", index: 0 }, { kind: "ACTIVITY", index: 0, extra: true },
    { kind: "ACTIVITY" },
  ]) {
    const brief = createEmptyBrief();
    brief.emphasis = [{
      priority: "PRIMARY", offerRefs: [offerRef], evidenceRefs: [{ ...EVIDENCE_REF }],
      relevanceReason: "Relevant",
    }];
    addEvidenceFacts(brief);
    expectInvalid(brief);
  }
});

test("evidence reference scalar and indexed field vocabulary is closed", () => {
  const valid = [
    ["EXPERIENCE", "role"], ["EXPERIENCE", "activities[0]"],
    ["PROJECT", "name"], ["PROJECT", "technologies[1]"], ["SKILL", "value"],
    ["EDUCATION", "diploma"], ["LANGUAGE", "language"], ["SOFT_SKILL", "value"],
  ];
  for (const [kind, field] of valid) {
    const brief = createEmptyBrief();
    brief.emphasis = [{
      priority: "PRIMARY", offerRefs: [{ ...OFFER_REF }],
      evidenceRefs: [{ kind, itemId: "item-1", field }], relevanceReason: "Relevant",
    }];
    assert.equal(new ApplicationBriefValidator().validate(addEvidenceFacts(brief)) instanceof ApplicationBrief, true);
  }
  for (const reference of [
    { kind: "UNKNOWN", itemId: "item-1", field: "value" },
    { kind: "SKILL", itemId: "bad id", field: "value" },
    { kind: "SKILL", itemId: "item-1", field: "id" },
    { kind: "EXPERIENCE", itemId: "item-1", field: "activities" },
    { kind: "EXPERIENCE", itemId: "item-1", field: "activities[]" },
    { kind: "EXPERIENCE", itemId: "item-1", field: "activities[-1]" },
    { kind: "EXPERIENCE", itemId: "item-1", field: "activities[01]" },
    { kind: "PROJECT", itemId: "item-1", field: `activities[${CandidateDossierLimits.MAXIMUM_ACTIVITIES}]` },
    { kind: "SKILL", itemId: "item-1", field: "value", extra: true },
  ]) {
    const brief = createEmptyBrief();
    brief.emphasis = [{
      priority: "PRIMARY", offerRefs: [{ ...OFFER_REF }], evidenceRefs: [reference],
      relevanceReason: "Relevant",
    }];
    expectInvalid(brief);
  }
});

test("facet totals duplicate texts refs and match-wide unique evidence limits are enforced", () => {
  const duplicateText = createEmptyBrief();
  duplicateText.requirementMatches = [{
    ...createSupportedMatch(),
    supportedFacets: [
      { text: "Same", evidenceRefs: [{ ...EVIDENCE_REF }] },
      { text: "Same", evidenceRefs: [{ ...EVIDENCE_REF, field: "organization" }] },
    ],
  }];
  addEvidenceFacts(duplicateText);
  expectInvalid(duplicateText);

  const tooMany = createEmptyBrief();
  tooMany.requirementMatches = [{
    offerRef: { ...OFFER_REF }, state: "SUPPORTED", notEvidencedFacets: [],
    supportedFacets: Array.from(
      { length: ApplicationBriefLimits.MAX_FACETS_PER_REQUIREMENT_MATCH + 1 },
      (_, index) => {
        return { text: `Facet ${index}`, evidenceRefs: [{ ...EVIDENCE_REF }] };
      },
    ),
  }];
  expectInvalid(tooMany);

  const duplicateRef = createEmptyBrief();
  duplicateRef.requirementMatches = [createSupportedMatch()];
  duplicateRef.requirementMatches[0].supportedFacets[0].evidenceRefs.push({ ...EVIDENCE_REF });
  expectInvalid(duplicateRef);
});

test("evidence facts enforce types uniqueness complete use and no orphans", () => {
  const booleanFact = createEmptyBrief();
  booleanFact.emphasis = [{
    priority: "PRIMARY", offerRefs: [{ ...OFFER_REF }],
    evidenceRefs: [{ kind: "EXPERIENCE", itemId: "exp-1", field: "current" }],
    relevanceReason: "Relevant",
  }];
  assert.equal(new ApplicationBriefValidator().validate(addEvidenceFacts(booleanFact)) instanceof ApplicationBrief, true);

  const wrongCurrent = structuredClone(booleanFact);
  wrongCurrent.evidenceFacts[0].value = "true";
  expectInvalid(wrongCurrent);
  const wrongString = createEmptyBrief();
  wrongString.evidenceFacts = [{ ref: { ...EVIDENCE_REF }, value: true }];
  expectInvalid(wrongString);

  const missing = createEmptyBrief();
  missing.requirementMatches = [createSupportedMatch()];
  expectInvalid(missing);
  const orphan = createEmptyBrief();
  orphan.evidenceFacts = [{ ref: { ...EVIDENCE_REF }, value: "Role" }];
  expectInvalid(orphan);
  const duplicate = addEvidenceFacts(structuredClone(booleanFact));
  duplicate.evidenceFacts.push(structuredClone(duplicate.evidenceFacts[0]));
  expectInvalid(duplicate);
});

test("all structured claim types require matching evidence kinds and non-empty refs", () => {
  const mappings = Object.entries({
    EXPERIENCE_FACT: "EXPERIENCE", PROJECT_FACT: "PROJECT", SKILL_DECLARATION: "SKILL",
    EDUCATION_FACT: "EDUCATION", LANGUAGE_DECLARATION: "LANGUAGE",
    SOFT_SKILL_DECLARATION: "SOFT_SKILL",
  });
  for (const [claimType, kind] of mappings) {
    const brief = createEmptyBrief();
    const field = kind === "PROJECT" ? "name" : kind === "EDUCATION" ? "diploma"
      : kind === "LANGUAGE" ? "language" : "value";
    const resolvedField = kind === "EXPERIENCE" ? "role" : field;
    brief.supportedClaims = [{
      claimType, offerRefs: [{ ...OFFER_REF }],
      evidenceRefs: [{ kind, itemId: "item-1", field: resolvedField }],
    }];
    assert.equal(new ApplicationBriefValidator().validate(addEvidenceFacts(brief)) instanceof ApplicationBrief, true);
    const mismatch = structuredClone(brief);
    mismatch.supportedClaims[0].claimType = "SKILL_DECLARATION";
    if (kind !== "SKILL") {
      expectInvalid(mismatch);
    }
  }
  for (const mutate of [
    (claim) => {
      claim.claimType = "UNKNOWN";
    },
    (claim) => {
      claim.offerRefs = [];
    },
    (claim) => {
      claim.evidenceRefs = [];
    },
  ]) {
    const brief = createEmptyBrief();
    const claim = {
      claimType: "EXPERIENCE_FACT", offerRefs: [{ ...OFFER_REF }], evidenceRefs: [{ ...EVIDENCE_REF }],
    };
    mutate(claim);
    brief.supportedClaims = [claim];
    addEvidenceFacts(brief);
    expectInvalid(brief);
  }
});

test("emphasis priorities cardinalities reason and limits are strict", () => {
  for (const priority of ["PRIMARY", "SECONDARY"]) {
    const brief = createEmptyBrief();
    brief.emphasis = [{
      priority, offerRefs: [{ ...OFFER_REF }], evidenceRefs: [{ ...EVIDENCE_REF }],
      relevanceReason: "Relevant",
    }];
    assert.equal(new ApplicationBriefValidator().validate(addEvidenceFacts(brief)) instanceof ApplicationBrief, true);
  }
  for (const mutate of [
    (item) => {
      item.priority = "UNKNOWN";
    },
    (item) => {
      item.offerRefs = [];
    },
    (item) => {
      item.evidenceRefs = [];
    },
    (item) => {
      item.relevanceReason = "";
    },
    (item) => {
      item.relevanceReason = "x"
        .repeat(ApplicationBriefLimits.MAX_RELEVANCE_REASON_LENGTH + 1);
    },
  ]) {
    const brief = createEmptyBrief();
    const item = {
      priority: "PRIMARY", offerRefs: [{ ...OFFER_REF }], evidenceRefs: [{ ...EVIDENCE_REF }],
      relevanceReason: "Relevant",
    };
    mutate(item);
    brief.emphasis = [item];
    addEvidenceFacts(brief);
    expectInvalid(brief);
  }
});

test("all closed caution kinds require offer and evidence references", () => {
  for (const kind of Object.values(ApplicationBriefConstants.CAUTION_KIND)) {
    const brief = createEmptyBrief();
    brief.cautions = [{ kind, offerRefs: [{ ...OFFER_REF }], evidenceRefs: [{ ...EVIDENCE_REF }] }];
    assert.equal(new ApplicationBriefValidator().validate(addEvidenceFacts(brief)) instanceof ApplicationBrief, true);
  }
  for (const caution of [
    { kind: "UNKNOWN", offerRefs: [{ ...OFFER_REF }], evidenceRefs: [{ ...EVIDENCE_REF }] },
    { kind: "DURATION_UNSUPPORTED", offerRefs: [], evidenceRefs: [{ ...EVIDENCE_REF }] },
    { kind: "DURATION_UNSUPPORTED", offerRefs: [{ ...OFFER_REF }], evidenceRefs: [] },
  ]) {
    const brief = createEmptyBrief();
    brief.cautions = [caution];
    addEvidenceFacts(brief);
    expectInvalid(brief);
  }
});

test("duplicate matches refs supported claims and cautions are rejected", () => {
  const duplicateMatch = createEmptyBrief();
  duplicateMatch.requirementMatches = [createSupportedMatch(), createSupportedMatch()];
  addEvidenceFacts(duplicateMatch);
  expectInvalid(duplicateMatch);

  const duplicateOfferRef = createEmptyBrief();
  duplicateOfferRef.emphasis = [{
    priority: "PRIMARY", offerRefs: [{ ...OFFER_REF }, { ...OFFER_REF }],
    evidenceRefs: [{ ...EVIDENCE_REF }], relevanceReason: "Relevant",
  }];
  addEvidenceFacts(duplicateOfferRef);
  expectInvalid(duplicateOfferRef);

  for (const field of ["supportedClaims", "cautions"]) {
    const brief = createEmptyBrief();
    const item = field === "supportedClaims"
      ? { claimType: "EXPERIENCE_FACT", offerRefs: [{ ...OFFER_REF }], evidenceRefs: [{ ...EVIDENCE_REF }] }
      : { kind: "DURATION_UNSUPPORTED", offerRefs: [{ ...OFFER_REF }], evidenceRefs: [{ ...EVIDENCE_REF }] };
    brief[field] = [structuredClone(item), structuredClone(item)];
    addEvidenceFacts(brief);
    expectInvalid(brief);
  }
});

test("requirement match accepts exactly eight unique evidence refs across facets", () => {
  const brief = createEmptyBrief();
  const references = createEvidenceRefs(ApplicationBriefLimits.MAX_EVIDENCE_REFS_PER_ITEM);
  brief.requirementMatches = [{
    offerRef: { ...OFFER_REF }, state: "SUPPORTED", notEvidencedFacets: [],
    supportedFacets: [
      { text: "First facet", evidenceRefs: references.slice(0, 1) },
      { text: "Second facet", evidenceRefs: references.slice(1) },
    ],
  }];

  assert.equal(
    new ApplicationBriefValidator().validate(addEvidenceFacts(brief)) instanceof ApplicationBrief,
    true,
  );
});

test("requirement match rejects nine unique evidence refs across facets", () => {
  const brief = createEmptyBrief();
  const references = createEvidenceRefs(ApplicationBriefLimits.MAX_EVIDENCE_REFS_PER_ITEM + 1);
  brief.requirementMatches = [{
    offerRef: { ...OFFER_REF }, state: "SUPPORTED", notEvidencedFacets: [],
    supportedFacets: [
      { text: "First facet", evidenceRefs: references.slice(0, 1) },
      { text: "Second facet", evidenceRefs: references.slice(1) },
    ],
  }];
  addEvidenceFacts(brief);

  assert.equal(new Set(references.map((reference) => {
    return JSON.stringify(reference);
  })).size, ApplicationBriefLimits.MAX_EVIDENCE_REFS_PER_ITEM + 1);
  expectInvalid(brief);
});

test("one shared ref across facets counts once in an eight-ref union", () => {
  const brief = createEmptyBrief();
  const references = createEvidenceRefs(ApplicationBriefLimits.MAX_EVIDENCE_REFS_PER_ITEM);
  brief.requirementMatches = [{
    offerRef: { ...OFFER_REF }, state: "SUPPORTED", notEvidencedFacets: [],
    supportedFacets: [
      { text: "First facet", evidenceRefs: references.slice(0, references.length - 1) },
      { text: "Second facet", evidenceRefs: references.slice(references.length - 1) },
      { text: "Shared facet", evidenceRefs: [structuredClone(references[0])] },
    ],
  }];

  assert.equal(brief.requirementMatches[0].supportedFacets.flatMap((facet) => {
    return facet.evidenceRefs;
  }).length, ApplicationBriefLimits.MAX_EVIDENCE_REFS_PER_ITEM + 1);
  assert.equal(
    new ApplicationBriefValidator().validate(addEvidenceFacts(brief)) instanceof ApplicationBrief,
    true,
  );
});

test("combined facet total accepts eight and rejects nine", () => {
  const supportedTexts = ["Supported A", "Supported B", "Supported C", "Supported D"];
  const missingTexts = ["Missing A", "Missing B", "Missing C", "Missing D"];
  const valid = createEmptyBrief();
  valid.requirementMatches = [{
    offerRef: { ...OFFER_REF }, state: "PARTIALLY_SUPPORTED",
    supportedFacets: supportedTexts.map((text) => {
      return { text, evidenceRefs: [{ ...EVIDENCE_REF }] };
    }),
    notEvidencedFacets: missingTexts.map((text) => {
      return { text };
    }),
  }];
  assert.equal(
    new ApplicationBriefValidator().validate(addEvidenceFacts(valid)) instanceof ApplicationBrief,
    true,
  );

  const invalid = structuredClone(valid);
  invalid.requirementMatches[0].notEvidencedFacets.push({ text: "Missing E" });
  expectInvalid(invalid);
});

test("duplicate and cross-collection facet texts are rejected exactly", () => {
  const duplicate = createEmptyBrief();
  duplicate.requirementMatches = [{
    offerRef: { ...OFFER_REF }, state: "NOT_EVIDENCED", supportedFacets: [],
    notEvidencedFacets: [{ text: "Same" }, { text: "Same" }],
  }];
  expectInvalid(duplicate);

  const overlap = createEmptyBrief();
  overlap.requirementMatches = [{
    offerRef: { ...OFFER_REF }, state: "PARTIALLY_SUPPORTED",
    supportedFacets: [{ text: "Same", evidenceRefs: [{ ...EVIDENCE_REF }] }],
    notEvidencedFacets: [{ text: "Same" }],
  }];
  addEvidenceFacts(overlap);
  expectInvalid(overlap);
});

test("direct item ref arrays accept eight unique refs and reject nine", () => {
  const valid = createEmptyBrief();
  valid.emphasis = [{
    priority: "PRIMARY",
    offerRefs: createOfferRefs(ApplicationBriefLimits.MAX_REFS_PER_ITEM),
    evidenceRefs: createEvidenceRefs(ApplicationBriefLimits.MAX_REFS_PER_ITEM),
    relevanceReason: "Relevant",
  }];
  assert.equal(
    new ApplicationBriefValidator().validate(addEvidenceFacts(valid)) instanceof ApplicationBrief,
    true,
  );

  const tooManyOfferRefs = structuredClone(valid);
  tooManyOfferRefs.emphasis[0].offerRefs = createOfferRefs(
    ApplicationBriefLimits.MAX_REFS_PER_ITEM + 1,
  );
  expectInvalid(tooManyOfferRefs);

  const tooManyEvidenceRefs = structuredClone(valid);
  tooManyEvidenceRefs.emphasis[0].evidenceRefs = createEvidenceRefs(
    ApplicationBriefLimits.MAX_REFS_PER_ITEM + 1,
  );
  addEvidenceFacts(tooManyEvidenceRefs);
  expectInvalid(tooManyEvidenceRefs);
});

test("claim and caution duplicate signatures ignore object key insertion order", () => {
  const fact = { ref: { ...EVIDENCE_REF }, value: "Role" };
  const claimBrief = createEmptyBrief();
  claimBrief.supportedClaims = [
    { claimType: "EXPERIENCE_FACT", offerRefs: [{ ...OFFER_REF }], evidenceRefs: [{ ...EVIDENCE_REF }] },
    {
      evidenceRefs: [{ field: "role", itemId: "exp-1", kind: "EXPERIENCE" }],
      offerRefs: [{ index: 0, kind: "REQUIREMENT" }], claimType: "EXPERIENCE_FACT",
    },
  ];
  claimBrief.evidenceFacts = [structuredClone(fact)];
  expectInvalid(claimBrief);

  const cautionBrief = createEmptyBrief();
  cautionBrief.cautions = [
    { kind: "DURATION_UNSUPPORTED", offerRefs: [{ ...OFFER_REF }], evidenceRefs: [{ ...EVIDENCE_REF }] },
    {
      evidenceRefs: [{ field: "role", itemId: "exp-1", kind: "EXPERIENCE" }],
      offerRefs: [{ index: 0, kind: "REQUIREMENT" }], kind: "DURATION_UNSUPPORTED",
    },
  ];
  cautionBrief.evidenceFacts = [structuredClone(fact)];
  expectInvalid(cautionBrief);
});

test("multi-ref claims accept all matching kinds and reject one mixed kind", () => {
  const valid = createEmptyBrief();
  valid.supportedClaims = [{
    claimType: "SKILL_DECLARATION", offerRefs: [{ ...OFFER_REF }],
    evidenceRefs: createEvidenceRefs(ApplicationBriefLimits.MAX_REFS_PER_ITEM, "SKILL", "value"),
  }];
  assert.equal(
    new ApplicationBriefValidator().validate(addEvidenceFacts(valid)) instanceof ApplicationBrief,
    true,
  );

  const mixed = structuredClone(valid);
  mixed.supportedClaims[0].evidenceRefs[1] = { ...EVIDENCE_REF };
  addEvidenceFacts(mixed);
  expectInvalid(mixed);
});

test("all indexed evidence field families enforce canonical syntax and upper bounds", () => {
  const validFields = [
    "activities[0]", `activities[${CandidateDossierLimits.MAXIMUM_ACTIVITIES - 1}]`,
    "achievements[0]", `achievements[${CandidateDossierLimits.MAXIMUM_ACHIEVEMENTS - 1}]`,
    "technologies[0]", `technologies[${CandidateDossierLimits.MAXIMUM_TECHNOLOGIES - 1}]`,
  ];
  for (const field of validFields) {
    const brief = createEmptyBrief();
    brief.emphasis = [{
      priority: "PRIMARY", offerRefs: [{ ...OFFER_REF }],
      evidenceRefs: [{ kind: "EXPERIENCE", itemId: "exp-1", field }],
      relevanceReason: "Relevant",
    }];
    assert.equal(
      new ApplicationBriefValidator().validate(addEvidenceFacts(brief)) instanceof ApplicationBrief,
      true,
    );
  }

  const invalidFields = [
    `activities[${CandidateDossierLimits.MAXIMUM_ACTIVITIES}]`,
    `achievements[${CandidateDossierLimits.MAXIMUM_ACHIEVEMENTS}]`,
    "achievements[-1]", "achievements[01]", "achievements[1.5]", "achievements[1]suffix",
    `technologies[${CandidateDossierLimits.MAXIMUM_TECHNOLOGIES}]`,
    "technologies[-1]", "technologies[01]", "technologies[1.5]", "technologies[1]suffix",
  ];
  for (const field of invalidFields) {
    const brief = createEmptyBrief();
    brief.emphasis = [{
      priority: "PRIMARY", offerRefs: [{ ...OFFER_REF }],
      evidenceRefs: [{ kind: "PROJECT", itemId: "project-1", field }],
      relevanceReason: "Relevant",
    }];
    expectInvalid(brief);
  }

  const projectAchievement = createEmptyBrief();
  projectAchievement.emphasis = [{
    priority: "PRIMARY", offerRefs: [{ ...OFFER_REF }],
    evidenceRefs: [{ kind: "PROJECT", itemId: "project-1", field: "achievements[0]" }],
    relevanceReason: "Relevant",
  }];
  assert.equal(
    new ApplicationBriefValidator().validate(addEvidenceFacts(projectAchievement)) instanceof ApplicationBrief,
    true,
  );
});
