import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationBriefConstants } from "../../src/constants/ApplicationBriefConstants.js";
import { ApplicationBriefLimits } from "../../src/constants/ApplicationBriefLimits.js";
import { CandidateDossierLimits } from "../../src/constants/CandidateDossierLimits.js";
import { OfferAnalysisLimits } from "../../src/constants/OfferAnalysisLimits.js";
import { ApplicationBriefMatcherError } from "../../src/services/ApplicationBriefMatcherError.js";
import { ApplicationBriefSemanticOutputValidator } from "../../src/services/ApplicationBriefSemanticOutputValidator.js";

const REQUIREMENT_REF = Object.freeze({ kind: "REQUIREMENT", index: 0 });
const ACTIVITY_REF = Object.freeze({ kind: "ACTIVITY", index: 0 });
const EXPERIENCE_REF = Object.freeze({
  kind: "EXPERIENCE", itemId: "experience-1", field: "role",
});
const CARDINALITY_FACET_SPLIT = 4;

/**
 * Build one valid empty semantic output.
 * @returns {object} Semantic output fixture.
 */
function createEmptyOutput() {
  return { requirementMatches: [], emphasis: [], supportedClaims: [], cautions: [] };
}

/**
 * Build one valid match for a requested evidence state.
 * @param {string} state - Evidence state.
 * @returns {object} Requirement match fixture.
 */
function createMatch(state) {
  const supportedFacets = state === "NOT_EVIDENCED" ? [] : [{
    text: "React", evidenceRefs: [structuredClone(EXPERIENCE_REF)],
  }];
  const notEvidencedFacets = state === "SUPPORTED" ? [] : [{ text: "5 ans" }];
  return {
    offerRef: structuredClone(REQUIREMENT_REF),
    state,
    supportedFacets,
    notEvidencedFacets,
  };
}

/**
 * Assert the single closed semantic validation failure.
 * @param {Function} action - Failing action.
 * @param {object} [expectedStructuralDetails] - Optional closed localization details.
 * @returns {void}
 */
function expectInvalid(action, expectedSubcode, expectedStructuralDetails) {
  assert.throws(action, (error) => {
    assert.equal(error instanceof ApplicationBriefMatcherError, true);
    assert.equal(error.code, "INVALID_APPLICATION_BRIEF_OUTPUT");
    assert.equal(error.reason, "INVALID_SEMANTIC_OUTPUT");
    if (expectedSubcode !== undefined) {
      assert.deepEqual(error.safeDetails, {
        validationCode: "SEMANTIC_VALIDATION",
        validationSubcode: expectedSubcode,
        ...expectedStructuralDetails,
      });
    }
    return true;
  });
}

test("semantic validator attaches closed diagnostics to representative failures", () => {
  const cases = [];
  cases.push([null, "ROOT_SHAPE_OR_KEYS"]);

  const wrongType = createEmptyOutput();
  wrongType.requirementMatches = null;
  cases.push([wrongType, "TYPE"]);

  const wrongEnum = createEmptyOutput();
  wrongEnum.requirementMatches = [createMatch("UNKNOWN")];
  cases.push([wrongEnum, "ENUM"]);

  const excessive = createEmptyOutput();
  excessive.emphasis = Array.from(
    { length: ApplicationBriefLimits.MAX_EMPHASIS + 1 },
    () => {
      return {};
    },
  );
  cases.push([excessive, "CARDINALITY", {
    cardinalityRule: "ROOT_EMPHASIS_MAX",
  }]);

  const duplicate = createEmptyOutput();
  duplicate.requirementMatches = [createMatch("SUPPORTED"), createMatch("SUPPORTED")];
  cases.push([duplicate, "DUPLICATE"]);

  const invalidState = createEmptyOutput();
  invalidState.requirementMatches = [createMatch("SUPPORTED")];
  invalidState.requirementMatches[0].notEvidencedFacets = [{ text: "5 ans" }];
  cases.push([invalidState, "STATE_FACET_INVARIANT"]);

  const claimMismatch = createEmptyOutput();
  claimMismatch.supportedClaims = [{
    claimType: "SKILL_DECLARATION",
    offerRefs: [structuredClone(REQUIREMENT_REF)],
    evidenceRefs: [structuredClone(EXPERIENCE_REF)],
  }];
  cases.push([claimMismatch, "CLAIM_EVIDENCE_KIND_MISMATCH"]);

  for (const [candidate, subcode, details] of cases) {
    expectInvalid(() => {
      new ApplicationBriefSemanticOutputValidator().validate(candidate);
    }, subcode, details);
  }
});

test("valid empty semantic output is detached and preserves input without mutation", () => {
  const input = createEmptyOutput();
  const snapshot = structuredClone(input);
  const result = new ApplicationBriefSemanticOutputValidator().validate(input);
  assert.deepEqual(result, snapshot);
  assert.notEqual(result, input);
  result.requirementMatches.push(createMatch("SUPPORTED"));
  assert.deepEqual(input, snapshot);
});

test("root requires exact four arrays and rejects missing unknown null and wrong types", () => {
  const validator = new ApplicationBriefSemanticOutputValidator();
  const candidates = [
    null,
    [],
    { ...createEmptyOutput(), unknown: true },
    { emphasis: [], supportedClaims: [], cautions: [] },
    { ...createEmptyOutput(), requirementMatches: null },
  ];
  for (const candidate of candidates) {
    expectInvalid(() => {
      validator.validate(candidate);
    });
  }
});

test("all three match states are valid only with their exact facet matrix", () => {
  const validator = new ApplicationBriefSemanticOutputValidator();
  for (const state of Object.values(ApplicationBriefConstants.EVIDENCE_STATE)) {
    const output = createEmptyOutput();
    output.requirementMatches = [createMatch(state)];
    assert.doesNotThrow(() => {
      validator.validate(output);
    });
  }
  for (const state of Object.values(ApplicationBriefConstants.EVIDENCE_STATE)) {
    const output = createEmptyOutput();
    output.requirementMatches = [createMatch(state)];
    output.requirementMatches[0].supportedFacets = [];
    output.requirementMatches[0].notEvidencedFacets = [];
    expectInvalid(() => {
      validator.validate(output);
    });
  }
});

test("requirement match container failures use content-free closed subrules", () => {
  const objectShapeCandidates = [null, [], "invalid", 1, true];
  for (const candidate of objectShapeCandidates) {
    const output = createEmptyOutput();
    output.requirementMatches = [candidate];
    expectInvalid(() => {
      new ApplicationBriefSemanticOutputValidator().validate(output);
    }, "NESTED_SHAPE_OR_KEYS", {
      nestedShapeRule: "REQUIREMENT_MATCH_OBJECT_SHAPE",
    });
  }

  const missingKey = createMatch("SUPPORTED");
  delete missingKey.state;
  const extraKey = { ...createMatch("SUPPORTED"), unknown: true };
  const replacedKey = createMatch("SUPPORTED");
  delete replacedKey.state;
  replacedKey.unknown = "SUPPORTED";
  for (const candidate of [missingKey, extraKey, replacedKey]) {
    const output = createEmptyOutput();
    output.requirementMatches = [candidate];
    expectInvalid(() => {
      new ApplicationBriefSemanticOutputValidator().validate(output);
    }, "NESTED_SHAPE_OR_KEYS", {
      nestedShapeRule: "REQUIREMENT_MATCH_EXACT_KEYS",
    });
  }
});

test("match refs facets duplicates overlap and unknown keys fail structurally", () => {
  const variants = [];
  const wrongKind = createMatch("SUPPORTED");
  wrongKind.offerRef.kind = "ACTIVITY";
  variants.push([wrongKind]);
  const duplicateMatch = createMatch("SUPPORTED");
  variants.push([duplicateMatch, structuredClone(duplicateMatch)]);
  const duplicateFacet = createMatch("SUPPORTED");
  duplicateFacet.supportedFacets.push(structuredClone(duplicateFacet.supportedFacets[0]));
  variants.push([duplicateFacet]);
  const overlap = createMatch("PARTIALLY_SUPPORTED");
  overlap.notEvidencedFacets[0].text = "React";
  variants.push([overlap]);
  const unknown = createMatch("SUPPORTED");
  unknown.unknown = true;
  variants.push([unknown]);
  for (const requirementMatches of variants) {
    const output = createEmptyOutput();
    output.requirementMatches = requirementMatches;
    expectInvalid(() => {
      new ApplicationBriefSemanticOutputValidator().validate(output);
    });
  }
});

test("offer refs accept indexed kinds and indexless seniority with exact shapes", () => {
  const validator = new ApplicationBriefSemanticOutputValidator();
  const valid = [
    REQUIREMENT_REF,
    ACTIVITY_REF,
    { kind: "CONTEXT", index: 0 },
    { kind: "SENIORITY" },
  ];
  for (const offerRef of valid) {
    const output = createEmptyOutput();
    output.emphasis = [{
      priority: "PRIMARY", offerRefs: [offerRef], evidenceRefs: [EXPERIENCE_REF],
      relevanceReason: "Relevant",
    }];
    assert.doesNotThrow(() => {
      validator.validate(output);
    });
  }
  for (const offerRef of [
    { kind: "UNKNOWN", index: 0 },
    { kind: "ACTIVITY" },
    { kind: "ACTIVITY", index: "0" },
    { kind: "SENIORITY", index: 0 },
    { kind: "ACTIVITY", index: 0, unknown: true },
  ]) {
    const output = createEmptyOutput();
    output.emphasis = [{
      priority: "PRIMARY", offerRefs: [offerRef], evidenceRefs: [EXPERIENCE_REF],
      relevanceReason: "Relevant",
    }];
    expectInvalid(() => {
      validator.validate(output);
    });
  }
});

test("evidence refs enforce closed kinds IDs scalar fields and indexed syntax", () => {
  const valid = [
    EXPERIENCE_REF,
    { kind: "EXPERIENCE", itemId: "experience-1", field: "activities[0]" },
    { kind: "PROJECT", itemId: "project-1", field: "activities[0]" },
    {
      kind: "PROJECT", itemId: "project-1",
      field: `activities[${CandidateDossierLimits.MAXIMUM_ACTIVITIES - 1}]`,
    },
    { kind: "PROJECT", itemId: "project-1", field: "achievements[0]" },
    {
      kind: "PROJECT", itemId: "project-1",
      field: `achievements[${CandidateDossierLimits.MAXIMUM_ACHIEVEMENTS - 1}]`,
    },
    { kind: "PROJECT", itemId: "project-1", field: "technologies[0]" },
    { kind: "SKILL", itemId: "skill-1", field: "value" },
    { kind: "EDUCATION", itemId: "education-1", field: "diploma" },
    { kind: "LANGUAGE", itemId: "language-1", field: "overall" },
    { kind: "SOFT_SKILL", itemId: "soft-skill-1", field: "detail" },
  ];
  for (const evidenceRef of valid) {
    const output = createEmptyOutput();
    output.emphasis = [{
      priority: "PRIMARY", offerRefs: [ACTIVITY_REF], evidenceRefs: [evidenceRef],
      relevanceReason: "Relevant",
    }];
    assert.doesNotThrow(() => {
      new ApplicationBriefSemanticOutputValidator().validate(output);
    });
  }
  const invalid = [
    { kind: "UNKNOWN", itemId: "item-1", field: "value" },
    { kind: "SKILL", itemId: "bad id", field: "value" },
    { kind: "SKILL", itemId: "skill-1", field: "unknown" },
    { kind: "SKILL", itemId: "skill-1", field: "value", value: "React" },
    {
      kind: "EXPERIENCE", itemId: "experience-1",
      field: `activities[${CandidateDossierLimits.MAXIMUM_ACTIVITIES}]`,
    },
    {
      kind: "PROJECT", itemId: "project-1",
      field: `activities[${CandidateDossierLimits.MAXIMUM_ACTIVITIES}]`,
    },
    {
      kind: "PROJECT", itemId: "project-1",
      field: `achievements[${CandidateDossierLimits.MAXIMUM_ACHIEVEMENTS}]`,
    },
  ];
  for (const evidenceRef of invalid) {
    const output = createEmptyOutput();
    output.emphasis = [{
      priority: "PRIMARY", offerRefs: [ACTIVITY_REF], evidenceRefs: [evidenceRef],
      relevanceReason: "Relevant",
    }];
    expectInvalid(() => {
      new ApplicationBriefSemanticOutputValidator().validate(output);
    });
  }
});

test("every claim type accepts only its matching evidence kind", () => {
  const mappings = {
    EXPERIENCE_FACT: "EXPERIENCE",
    PROJECT_FACT: "PROJECT",
    SKILL_DECLARATION: "SKILL",
    EDUCATION_FACT: "EDUCATION",
    LANGUAGE_DECLARATION: "LANGUAGE",
    SOFT_SKILL_DECLARATION: "SOFT_SKILL",
  };
  for (const [claimType, kind] of Object.entries(mappings)) {
    const field = kind === "EXPERIENCE" ? "role"
      : kind === "PROJECT" ? "name"
        : kind === "EDUCATION" ? "diploma"
          : kind === "LANGUAGE" ? "language" : "value";
    const claim = {
      claimType, offerRefs: [REQUIREMENT_REF],
      evidenceRefs: [{ kind, itemId: "item-1", field }],
    };
    const output = createEmptyOutput();
    output.supportedClaims = [claim];
    assert.doesNotThrow(() => {
      new ApplicationBriefSemanticOutputValidator().validate(output);
    });
    const mismatch = structuredClone(output);
    mismatch.supportedClaims[0].evidenceRefs.push(structuredClone(EXPERIENCE_REF));
    if (kind === "EXPERIENCE") {
      mismatch.supportedClaims[0].evidenceRefs.push({
        kind: "SKILL", itemId: "skill-1", field: "value",
      });
    }
    expectInvalid(() => {
      new ApplicationBriefSemanticOutputValidator().validate(mismatch);
    });
  }
});

test("claims reject free text and canonical duplicates independent of key order", () => {
  const claim = {
    claimType: "EXPERIENCE_FACT",
    offerRefs: [REQUIREMENT_REF],
    evidenceRefs: [EXPERIENCE_REF],
  };
  const withText = { ...claim, text: "React experience" };
  const duplicate = {
    evidenceRefs: [EXPERIENCE_REF], offerRefs: [REQUIREMENT_REF],
    claimType: "EXPERIENCE_FACT",
  };
  for (const supportedClaims of [[withText], [claim, duplicate]]) {
    const output = createEmptyOutput();
    output.supportedClaims = supportedClaims;
    expectInvalid(() => {
      new ApplicationBriefSemanticOutputValidator().validate(output);
    });
  }
});

test("all caution kinds are valid while unknown empty refs and duplicates fail", () => {
  for (const kind of Object.values(ApplicationBriefConstants.CAUTION_KIND)) {
    const output = createEmptyOutput();
    output.cautions = [{ kind, offerRefs: [REQUIREMENT_REF], evidenceRefs: [EXPERIENCE_REF] }];
    assert.doesNotThrow(() => {
      new ApplicationBriefSemanticOutputValidator().validate(output);
    });
  }
  const base = {
    kind: "DURATION_UNSUPPORTED",
    offerRefs: [REQUIREMENT_REF],
    evidenceRefs: [EXPERIENCE_REF],
  };
  for (const cautions of [
    [{ ...base, kind: "UNKNOWN" }],
    [{ ...base, offerRefs: [] }],
    [{ ...base, evidenceRefs: [] }],
    [base, structuredClone(base)],
  ]) {
    const output = createEmptyOutput();
    output.cautions = cautions;
    expectInvalid(() => {
      new ApplicationBriefSemanticOutputValidator().validate(output);
    });
  }
});

test("caution duplicate signatures ignore root and nested key insertion order", () => {
  const output = createEmptyOutput();
  output.cautions = [{
    kind: "DURATION_UNSUPPORTED",
    offerRefs: [{ kind: "REQUIREMENT", index: 0 }],
    evidenceRefs: [{ kind: "EXPERIENCE", itemId: "experience-1", field: "role" }],
  }, {
    evidenceRefs: [{ field: "role", itemId: "experience-1", kind: "EXPERIENCE" }],
    offerRefs: [{ index: 0, kind: "REQUIREMENT" }],
    kind: "DURATION_UNSUPPORTED",
  }];
  expectInvalid(() => {
    new ApplicationBriefSemanticOutputValidator().validate(output);
  });
});

test("emphasis accepts priorities and rejects reason ref and priority violations", () => {
  for (const priority of Object.values(ApplicationBriefConstants.PRIORITY)) {
    const output = createEmptyOutput();
    output.emphasis = [{
      priority, offerRefs: [ACTIVITY_REF], evidenceRefs: [EXPERIENCE_REF],
      relevanceReason: "Relevant",
    }];
    assert.doesNotThrow(() => {
      new ApplicationBriefSemanticOutputValidator().validate(output);
    });
  }
  const base = {
    priority: "PRIMARY", offerRefs: [ACTIVITY_REF], evidenceRefs: [EXPERIENCE_REF],
    relevanceReason: "Relevant",
  };
  for (const emphasis of [
    [{ ...base, priority: "UNKNOWN" }],
    [{ ...base, relevanceReason: "" }],
    [{ ...base, relevanceReason: "   " }],
    [{ ...base, relevanceReason: "a".repeat(ApplicationBriefLimits.MAX_RELEVANCE_REASON_LENGTH + 1) }],
    [{ ...base, offerRefs: [] }],
    [{ ...base, evidenceRefs: [] }],
  ]) {
    const output = createEmptyOutput();
    output.emphasis = emphasis;
    expectInvalid(() => {
      new ApplicationBriefSemanticOutputValidator().validate(output);
    });
  }
});

test("whitespace-only facets fail while valid surrounding spaces remain unchanged", () => {
  const invalid = createEmptyOutput();
  invalid.requirementMatches = [createMatch("SUPPORTED")];
  invalid.requirementMatches[0].supportedFacets[0].text = "   ";
  expectInvalid(() => {
    new ApplicationBriefSemanticOutputValidator().validate(invalid);
  }, "TEXT_OR_IDENTIFIER_FORMAT", {
    validationPath: "requirementMatches[0].supportedFacets[0].text",
    validationCategory: "TEXT",
    validationRule: "TEXT_BLANK",
  });

  const valid = createEmptyOutput();
  valid.requirementMatches = [createMatch("SUPPORTED")];
  valid.requirementMatches[0].supportedFacets[0].text = " React ";
  valid.emphasis = [{
    priority: "PRIMARY", offerRefs: [ACTIVITY_REF], evidenceRefs: [EXPERIENCE_REF],
    relevanceReason: "  Relevant exactly  ",
  }];
  const result = new ApplicationBriefSemanticOutputValidator().validate(valid);
  assert.equal(result.requirementMatches[0].supportedFacets[0].text, " React ");
  assert.equal(result.emphasis[0].relevanceReason, "  Relevant exactly  ");
});

test("text failures expose only closed structural localization", () => {
  const notEvidenced = createEmptyOutput();
  notEvidenced.requirementMatches = [createMatch("NOT_EVIDENCED")];
  notEvidenced.requirementMatches[0].notEvidencedFacets[0].text = "x".repeat(
    OfferAnalysisLimits.MAXIMUM_VALUE_LENGTH + 1,
  );
  expectInvalid(() => {
    new ApplicationBriefSemanticOutputValidator().validate(notEvidenced);
  }, "TEXT_OR_IDENTIFIER_FORMAT", {
    validationPath: "requirementMatches[0].notEvidencedFacets[0].text",
    validationCategory: "TEXT",
    validationRule: "TEXT_TOO_LONG",
  });

  const emphasis = createEmptyOutput();
  emphasis.emphasis = [{
    priority: "PRIMARY",
    offerRefs: [ACTIVITY_REF],
    evidenceRefs: [EXPERIENCE_REF],
    relevanceReason: "   ",
  }];
  expectInvalid(() => {
    new ApplicationBriefSemanticOutputValidator().validate(emphasis);
  }, "TEXT_OR_IDENTIFIER_FORMAT", {
    validationPath: "emphasis[0].relevanceReason",
    validationCategory: "TEXT",
    validationRule: "TEXT_BLANK",
  });
});

test("evidence identifiers expose closed rules without rejected values", () => {
  const cases = [
    ["private invalid id", "ITEM_ID_INVALID_CHARSET"],
    ["x".repeat(CandidateDossierLimits.MAXIMUM_ID_LENGTH + 1), "ITEM_ID_TOO_LONG"],
  ];
  for (const [itemId, validationRule] of cases) {
    const output = createEmptyOutput();
    output.emphasis = [{
      priority: "PRIMARY",
      offerRefs: [ACTIVITY_REF],
      evidenceRefs: [{ ...EXPERIENCE_REF, itemId }],
      relevanceReason: "Relevant",
    }];
    assert.throws(() => {
      new ApplicationBriefSemanticOutputValidator().validate(output);
    }, (error) => {
      assert.deepEqual(error.safeDetails, {
        validationCode: "SEMANTIC_VALIDATION",
        validationSubcode: "TEXT_OR_IDENTIFIER_FORMAT",
        validationPath: "emphasis[0].evidenceRefs[0].itemId",
        validationCategory: "IDENTIFIER_ITEM_ID",
        validationRule,
      });
      assert.equal(JSON.stringify(error.safeDetails).includes(itemId), false);
      return true;
    });
  }
});

test("evidence fields distinguish closed syntax kind and range failures", () => {
  const cases = [
    ["EXPERIENCE", "privateField", "FIELD_UNKNOWN_SCALAR"],
    ["EXPERIENCE", "activities[01]", "FIELD_INVALID_INDEXED_SYNTAX"],
    ["SKILL", "activities[0]", "FIELD_KIND_INCOMPATIBLE"],
    [
      "EXPERIENCE",
      `activities[${CandidateDossierLimits.MAXIMUM_ACTIVITIES}]`,
      "FIELD_INDEX_OUT_OF_NORMATIVE_RANGE",
    ],
  ];
  for (const [kind, field, validationRule] of cases) {
    const output = createEmptyOutput();
    output.cautions = [{
      kind: "DURATION_UNSUPPORTED",
      offerRefs: [REQUIREMENT_REF],
      evidenceRefs: [{ kind, itemId: "item-1", field }],
    }];
    assert.throws(() => {
      new ApplicationBriefSemanticOutputValidator().validate(output);
    }, (error) => {
      assert.deepEqual(error.safeDetails, {
        validationCode: "SEMANTIC_VALIDATION",
        validationSubcode: "TEXT_OR_IDENTIFIER_FORMAT",
        validationPath: "cautions[0].evidenceRefs[0].field",
        validationCategory: "IDENTIFIER_FIELD",
        validationRule,
      });
      assert.equal(JSON.stringify(error.safeDetails).includes(field), false);
      return true;
    });
  }
});

test("match-wide evidence union enforces its limit and counts shared refs once", () => {
  const references = Array.from({
    length: ApplicationBriefLimits.MAX_EVIDENCE_REFS_PER_ITEM,
  }, (_, index) => {
    return { kind: "EXPERIENCE", itemId: `experience-${index}`, field: "role" };
  });
  const output = createEmptyOutput();
  output.requirementMatches = [{
    offerRef: structuredClone(REQUIREMENT_REF),
    state: "SUPPORTED",
    supportedFacets: [{ text: "React", evidenceRefs: references.slice(0, -1) }, {
      text: "Node", evidenceRefs: [references[0], references.at(-1)],
    }],
    notEvidencedFacets: [],
  }];
  assert.doesNotThrow(() => {
    new ApplicationBriefSemanticOutputValidator().validate(output);
  });

  const excessive = structuredClone(output);
  excessive.requirementMatches[0].supportedFacets[1].evidenceRefs.push({
    kind: "EXPERIENCE", itemId: "experience-extra", field: "role",
  });
  expectInvalid(() => {
    new ApplicationBriefSemanticOutputValidator().validate(excessive);
  }, "CARDINALITY", {
    cardinalityRule: "REQUIREMENT_UNIQUE_SUPPORTED_EVIDENCE_REFS_MAX",
  });
});

test("global evidence union enforces the final fact limit and counts cross-root refs once", () => {
  /**
   * Build one maximum-sized unique evidence ref group.
   * @param {string} prefix - Collection identity prefix.
   * @param {number} itemIndex - Parent item index.
   * @returns {object[]} Evidence reference group.
   */
  function createRefs(prefix, itemIndex) {
    return Array.from({ length: ApplicationBriefLimits.MAX_REFS_PER_ITEM }, (_, refIndex) => {
      return {
        kind: "EXPERIENCE", itemId: `${prefix}-${itemIndex}-${refIndex}`, field: "role",
      };
    });
  }
  const output = createEmptyOutput();
  output.requirementMatches = Array.from({
    length: ApplicationBriefLimits.MAX_REQUIREMENT_MATCHES,
  }, (_, index) => {
    return {
      offerRef: { kind: "REQUIREMENT", index },
      state: "SUPPORTED",
      supportedFacets: [{ text: `requirement-${index}`, evidenceRefs: createRefs("match", index) }],
      notEvidencedFacets: [],
    };
  });
  output.emphasis = Array.from({ length: ApplicationBriefLimits.MAX_EMPHASIS }, (_, index) => {
    return {
      priority: "SECONDARY",
      offerRefs: [{ kind: "ACTIVITY", index }],
      evidenceRefs: createRefs("emphasis", index),
      relevanceReason: `relevance-${index}`,
    };
  });
  output.cautions = [{
    kind: "DURATION_UNSUPPORTED",
    offerRefs: [{ kind: "REQUIREMENT", index: 0 }],
    evidenceRefs: [output.requirementMatches[0].supportedFacets[0].evidenceRefs[0]],
  }];
  assert.doesNotThrow(() => {
    new ApplicationBriefSemanticOutputValidator().validate(output);
  });

  const excessive = structuredClone(output);
  excessive.supportedClaims = [{
    claimType: "EXPERIENCE_FACT",
    offerRefs: [{ kind: "REQUIREMENT", index: 0 }],
    evidenceRefs: [{ kind: "EXPERIENCE", itemId: "extra-global-ref", field: "role" }],
  }];
  expectInvalid(() => {
    new ApplicationBriefSemanticOutputValidator().validate(excessive);
  }, "EVIDENCE_GLOBAL_LIMIT");
});

test("every cardinality predicate emits its exact closed rule", () => {
  const limit = ApplicationBriefLimits;
  /**
   * Build unique valid evidence references.
   * @param {number} count - Requested reference count.
   * @returns {object[]} Evidence references.
   */
  function createEvidenceRefs(count) {
    return Array.from({ length: count }, (_, index) => {
      return { kind: "EXPERIENCE", itemId: `experience-${index}`, field: "role" };
    });
  }
  /**
   * Build unique valid offer references.
   * @param {number} count - Requested reference count.
   * @returns {object[]} Offer references.
   */
  function createOfferRefs(count) {
    return Array.from({ length: count }, (_, index) => {
      return { kind: "ACTIVITY", index };
    });
  }
  /**
   * Build one valid emphasis entry.
   * @returns {object} Emphasis entry.
   */
  function createEmphasis() {
    return {
      priority: "PRIMARY",
      offerRefs: [structuredClone(ACTIVITY_REF)],
      evidenceRefs: [structuredClone(EXPERIENCE_REF)],
      relevanceReason: "Relevant",
    };
  }
  /**
   * Build one valid supported claim.
   * @returns {object} Supported claim.
   */
  function createClaim() {
    return {
      claimType: "EXPERIENCE_FACT",
      offerRefs: [structuredClone(REQUIREMENT_REF)],
      evidenceRefs: [structuredClone(EXPERIENCE_REF)],
    };
  }
  /**
   * Build one valid caution.
   * @returns {object} Caution.
   */
  function createCaution() {
    return {
      kind: "DURATION_UNSUPPORTED",
      offerRefs: [structuredClone(REQUIREMENT_REF)],
      evidenceRefs: [structuredClone(EXPERIENCE_REF)],
    };
  }
  const cases = [
    ["ROOT_REQUIREMENT_MATCHES_MAX", (output) => {
      output.requirementMatches = Array(limit.MAX_REQUIREMENT_MATCHES + 1).fill(null);
    }],
    ["ROOT_EMPHASIS_MAX", (output) => {
      output.emphasis = Array(limit.MAX_EMPHASIS + 1).fill(null);
    }],
    ["ROOT_SUPPORTED_CLAIMS_MAX", (output) => {
      output.supportedClaims = Array(limit.MAX_SUPPORTED_CLAIMS + 1).fill(null);
    }],
    ["ROOT_CAUTIONS_MAX", (output) => {
      output.cautions = Array(limit.MAX_CAUTIONS + 1).fill(null);
    }],
    ["REQUIREMENT_SUPPORTED_FACETS_MAX", (output) => {
      const match = createMatch("SUPPORTED");
      match.supportedFacets = Array(limit.MAX_FACETS_PER_REQUIREMENT_MATCH + 1).fill(null);
      output.requirementMatches = [match];
    }],
    ["REQUIREMENT_NOT_EVIDENCED_FACETS_MAX", (output) => {
      const match = createMatch("NOT_EVIDENCED");
      match.notEvidencedFacets = Array(limit.MAX_FACETS_PER_REQUIREMENT_MATCH + 1).fill(null);
      output.requirementMatches = [match];
    }],
    ["REQUIREMENT_COMBINED_FACETS_MAX", (output) => {
      const match = createMatch("PARTIALLY_SUPPORTED");
      match.supportedFacets = Array.from({ length: CARDINALITY_FACET_SPLIT }, (_, index) => {
        return { text: `supported-${index}`, evidenceRefs: [structuredClone(EXPERIENCE_REF)] };
      });
      match.notEvidencedFacets = Array.from({
        length: limit.MAX_FACETS_PER_REQUIREMENT_MATCH - CARDINALITY_FACET_SPLIT + 1,
      }, (_, index) => {
        return { text: `missing-${index}` };
      });
      output.requirementMatches = [match];
    }],
    ["REQUIREMENT_UNIQUE_SUPPORTED_EVIDENCE_REFS_MAX", (output) => {
      const references = createEvidenceRefs(limit.MAX_EVIDENCE_REFS_PER_ITEM + 1);
      output.requirementMatches = [{
        offerRef: structuredClone(REQUIREMENT_REF),
        state: "SUPPORTED",
        supportedFacets: [
          { text: "first", evidenceRefs: references.slice(0, CARDINALITY_FACET_SPLIT) },
          { text: "second", evidenceRefs: references.slice(CARDINALITY_FACET_SPLIT) },
        ],
        notEvidencedFacets: [],
      }];
    }],
    ["SUPPORTED_FACET_EVIDENCE_REFS_MIN_ONE", (output) => {
      const match = createMatch("SUPPORTED");
      match.supportedFacets[0].evidenceRefs = [];
      output.requirementMatches = [match];
    }],
    ["SUPPORTED_FACET_EVIDENCE_REFS_MAX", (output) => {
      const match = createMatch("SUPPORTED");
      match.supportedFacets[0].evidenceRefs = createEvidenceRefs(limit.MAX_REFS_PER_ITEM + 1);
      output.requirementMatches = [match];
    }],
    ["EMPHASIS_OFFER_REFS_MIN_ONE", (output) => {
      const emphasis = createEmphasis();
      emphasis.offerRefs = [];
      output.emphasis = [emphasis];
    }],
    ["EMPHASIS_OFFER_REFS_MAX", (output) => {
      const emphasis = createEmphasis();
      emphasis.offerRefs = createOfferRefs(limit.MAX_REFS_PER_ITEM + 1);
      output.emphasis = [emphasis];
    }],
    ["EMPHASIS_EVIDENCE_REFS_MIN_ONE", (output) => {
      const emphasis = createEmphasis();
      emphasis.evidenceRefs = [];
      output.emphasis = [emphasis];
    }],
    ["EMPHASIS_EVIDENCE_REFS_MAX", (output) => {
      const emphasis = createEmphasis();
      emphasis.evidenceRefs = createEvidenceRefs(limit.MAX_REFS_PER_ITEM + 1);
      output.emphasis = [emphasis];
    }],
    ["SUPPORTED_CLAIM_OFFER_REFS_MIN_ONE", (output) => {
      const claim = createClaim();
      claim.offerRefs = [];
      output.supportedClaims = [claim];
    }],
    ["SUPPORTED_CLAIM_OFFER_REFS_MAX", (output) => {
      const claim = createClaim();
      claim.offerRefs = createOfferRefs(limit.MAX_REFS_PER_ITEM + 1);
      output.supportedClaims = [claim];
    }],
    ["SUPPORTED_CLAIM_EVIDENCE_REFS_MIN_ONE", (output) => {
      const claim = createClaim();
      claim.evidenceRefs = [];
      output.supportedClaims = [claim];
    }],
    ["SUPPORTED_CLAIM_EVIDENCE_REFS_MAX", (output) => {
      const claim = createClaim();
      claim.evidenceRefs = createEvidenceRefs(limit.MAX_REFS_PER_ITEM + 1);
      output.supportedClaims = [claim];
    }],
    ["CAUTION_OFFER_REFS_MIN_ONE", (output) => {
      const caution = createCaution();
      caution.offerRefs = [];
      output.cautions = [caution];
    }],
    ["CAUTION_OFFER_REFS_MAX", (output) => {
      const caution = createCaution();
      caution.offerRefs = createOfferRefs(limit.MAX_REFS_PER_ITEM + 1);
      output.cautions = [caution];
    }],
    ["CAUTION_EVIDENCE_REFS_MIN_ONE", (output) => {
      const caution = createCaution();
      caution.evidenceRefs = [];
      output.cautions = [caution];
    }],
    ["CAUTION_EVIDENCE_REFS_MAX", (output) => {
      const caution = createCaution();
      caution.evidenceRefs = createEvidenceRefs(limit.MAX_REFS_PER_ITEM + 1);
      output.cautions = [caution];
    }],
  ];

  assert.equal(cases.length, Object.keys(ApplicationBriefMatcherError.CARDINALITY_RULE).length);
  for (const [cardinalityRule, mutate] of cases) {
    const output = createEmptyOutput();
    mutate(output);
    expectInvalid(() => {
      new ApplicationBriefSemanticOutputValidator().validate(output);
    }, "CARDINALITY", { cardinalityRule });
  }
});

test("every nested-shape predicate emits its exact closed rule", () => {
  const cases = [
    ["REQUIREMENT_MATCH_OBJECT_SHAPE", (output) => {
      output.requirementMatches = [null];
    }],
    ["REQUIREMENT_MATCH_EXACT_KEYS", (output) => {
      output.requirementMatches = [{ ...createMatch("SUPPORTED"), unknown: true }];
    }],
    ["SUPPORTED_FACET_SHAPE", (output) => {
      const match = createMatch("SUPPORTED");
      match.supportedFacets[0].unknown = true;
      output.requirementMatches = [match];
    }],
    ["NOT_EVIDENCED_FACET_SHAPE", (output) => {
      const match = createMatch("NOT_EVIDENCED");
      match.notEvidencedFacets[0].unknown = true;
      output.requirementMatches = [match];
    }],
    ["EMPHASIS_SHAPE", (output) => {
      output.emphasis = [{
        priority: "PRIMARY",
        offerRefs: [structuredClone(ACTIVITY_REF)],
        evidenceRefs: [structuredClone(EXPERIENCE_REF)],
        relevanceReason: "Relevant",
        unknown: true,
      }];
    }],
    ["SUPPORTED_CLAIM_SHAPE", (output) => {
      output.supportedClaims = [{
        claimType: "EXPERIENCE_FACT",
        offerRefs: [structuredClone(REQUIREMENT_REF)],
        evidenceRefs: [structuredClone(EXPERIENCE_REF)],
        unknown: true,
      }];
    }],
    ["CAUTION_SHAPE", (output) => {
      output.cautions = [{
        kind: "DURATION_UNSUPPORTED",
        offerRefs: [structuredClone(REQUIREMENT_REF)],
        evidenceRefs: [structuredClone(EXPERIENCE_REF)],
        unknown: true,
      }];
    }],
    ["OFFER_REF_INDEXED_SHAPE", (output) => {
      output.emphasis = [{
        priority: "PRIMARY",
        offerRefs: [{ ...ACTIVITY_REF, unknown: true }],
        evidenceRefs: [structuredClone(EXPERIENCE_REF)],
        relevanceReason: "Relevant",
      }];
    }],
    ["OFFER_REF_SENIORITY_SHAPE", (output) => {
      output.emphasis = [{
        priority: "PRIMARY",
        offerRefs: [{ kind: "SENIORITY", index: 0 }],
        evidenceRefs: [structuredClone(EXPERIENCE_REF)],
        relevanceReason: "Relevant",
      }];
    }],
    ["EVIDENCE_REF_SHAPE", (output) => {
      output.emphasis = [{
        priority: "PRIMARY",
        offerRefs: [structuredClone(ACTIVITY_REF)],
        evidenceRefs: [{ ...EXPERIENCE_REF, unknown: true }],
        relevanceReason: "Relevant",
      }];
    }],
  ];

  assert.equal(cases.length, Object.keys(ApplicationBriefMatcherError.NESTED_SHAPE_RULE).length);
  for (const [nestedShapeRule, mutate] of cases) {
    const output = createEmptyOutput();
    mutate(output);
    expectInvalid(() => {
      new ApplicationBriefSemanticOutputValidator().validate(output);
    }, "NESTED_SHAPE_OR_KEYS", { nestedShapeRule });
  }
});

test("normative collection ref and facet limits are enforced", () => {
  const cases = [
    ["requirementMatches", ApplicationBriefLimits.MAX_REQUIREMENT_MATCHES],
    ["emphasis", ApplicationBriefLimits.MAX_EMPHASIS],
    ["supportedClaims", ApplicationBriefLimits.MAX_SUPPORTED_CLAIMS],
    ["cautions", ApplicationBriefLimits.MAX_CAUTIONS],
  ];
  for (const [field, limit] of cases) {
    const output = createEmptyOutput();
    output[field] = Array.from({ length: limit + 1 }, () => {
      return null;
    });
    expectInvalid(() => {
      new ApplicationBriefSemanticOutputValidator().validate(output);
    });
  }
  const refsOutput = createEmptyOutput();
  refsOutput.emphasis = [{
    priority: "PRIMARY",
    offerRefs: Array.from({ length: ApplicationBriefLimits.MAX_REFS_PER_ITEM + 1 }, (_, index) => {
      return { kind: "ACTIVITY", index };
    }),
    evidenceRefs: [EXPERIENCE_REF],
    relevanceReason: "Relevant",
  }];
  expectInvalid(() => {
    new ApplicationBriefSemanticOutputValidator().validate(refsOutput);
  });
  const facetOutput = createEmptyOutput();
  facetOutput.requirementMatches = [createMatch("SUPPORTED")];
  facetOutput.requirementMatches[0].supportedFacets = Array.from({
    length: ApplicationBriefLimits.MAX_FACETS_PER_REQUIREMENT_MATCH + 1,
  }, (_, index) => {
    return { text: `facet-${index}`, evidenceRefs: [EXPERIENCE_REF] };
  });
  expectInvalid(() => {
    new ApplicationBriefSemanticOutputValidator().validate(facetOutput);
  });
});

test("validation preserves ordering values whitespace and casing exactly", () => {
  const output = createEmptyOutput();
  output.requirementMatches = [createMatch("PARTIALLY_SUPPORTED")];
  output.requirementMatches[0].supportedFacets[0].text = " React ";
  output.emphasis = [{
    priority: "PRIMARY",
    offerRefs: [{ kind: "ACTIVITY", index: 1 }, { kind: "ACTIVITY", index: 0 }],
    evidenceRefs: [EXPERIENCE_REF],
    relevanceReason: "  Relevant exactly  ",
  }];
  const snapshot = structuredClone(output);
  const result = new ApplicationBriefSemanticOutputValidator().validate(output);
  assert.deepEqual(result, snapshot);
  assert.deepEqual(output, snapshot);
});
