import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationBriefMatcherError } from "../../src/services/ApplicationBriefMatcherError.js";

test("matcher error exposes only stable safe codes and the consumed semantic reason", () => {
  assert.deepEqual(Object.values(ApplicationBriefMatcherError.CODE), [
    "INVALID_APPLICATION_BRIEF_OUTPUT",
    "APPLICATION_BRIEF_INPUT_TOO_LARGE",
    "APPLICATION_BRIEF_UNAVAILABLE",
    "APPLICATION_BRIEF_TIMEOUT",
    "APPLICATION_BRIEF_RATE_LIMITED",
    "APPLICATION_BRIEF_PROVIDER_TOKEN_BUDGET",
    "APPLICATION_BRIEF_PROVIDER_ERROR",
  ]);
  assert.deepEqual(Object.values(ApplicationBriefMatcherError.REASON), [
    "INVALID_SEMANTIC_OUTPUT",
    "INVALID_CONTEXTUAL_OUTPUT",
    "CROSS_CLASS_RETRY_SKIPPED_TOKEN_HEADROOM",
  ]);
  assert.deepEqual(Object.values(ApplicationBriefMatcherError.VALIDATION_CODE), [
    "PROVIDER_INVALID_RESPONSE",
    "SEMANTIC_VALIDATION",
    "CONTEXTUAL_VALIDATION",
  ]);
  assert.deepEqual(Object.values(ApplicationBriefMatcherError.SEMANTIC_VALIDATION_SUBCODE), [
    "ROOT_SHAPE_OR_KEYS",
    "NESTED_SHAPE_OR_KEYS",
    "TYPE",
    "ENUM",
    "TEXT_OR_IDENTIFIER_FORMAT",
    "CARDINALITY",
    "DUPLICATE",
    "STATE_FACET_INVARIANT",
    "CLAIM_EVIDENCE_KIND_MISMATCH",
    "EVIDENCE_GLOBAL_LIMIT",
  ]);
  assert.deepEqual(Object.values(ApplicationBriefMatcherError.CARDINALITY_RULE), [
    "ROOT_REQUIREMENT_MATCHES_MAX",
    "ROOT_EMPHASIS_MAX",
    "ROOT_SUPPORTED_CLAIMS_MAX",
    "ROOT_CAUTIONS_MAX",
    "REQUIREMENT_SUPPORTED_FACETS_MAX",
    "REQUIREMENT_NOT_EVIDENCED_FACETS_MAX",
    "REQUIREMENT_COMBINED_FACETS_MAX",
    "REQUIREMENT_UNIQUE_SUPPORTED_EVIDENCE_REFS_MAX",
    "SUPPORTED_FACET_EVIDENCE_REFS_MIN_ONE",
    "SUPPORTED_FACET_EVIDENCE_REFS_MAX",
    "EMPHASIS_OFFER_REFS_MIN_ONE",
    "EMPHASIS_OFFER_REFS_MAX",
    "EMPHASIS_EVIDENCE_REFS_MIN_ONE",
    "EMPHASIS_EVIDENCE_REFS_MAX",
    "SUPPORTED_CLAIM_OFFER_REFS_MIN_ONE",
    "SUPPORTED_CLAIM_OFFER_REFS_MAX",
    "SUPPORTED_CLAIM_EVIDENCE_REFS_MIN_ONE",
    "SUPPORTED_CLAIM_EVIDENCE_REFS_MAX",
    "CAUTION_OFFER_REFS_MIN_ONE",
    "CAUTION_OFFER_REFS_MAX",
    "CAUTION_EVIDENCE_REFS_MIN_ONE",
    "CAUTION_EVIDENCE_REFS_MAX",
  ]);
  assert.deepEqual(Object.values(ApplicationBriefMatcherError.NESTED_SHAPE_RULE), [
    "REQUIREMENT_MATCH_SHAPE",
    "SUPPORTED_FACET_SHAPE",
    "NOT_EVIDENCED_FACET_SHAPE",
    "EMPHASIS_SHAPE",
    "SUPPORTED_CLAIM_SHAPE",
    "CAUTION_SHAPE",
    "OFFER_REF_INDEXED_SHAPE",
    "OFFER_REF_SENIORITY_SHAPE",
    "EVIDENCE_REF_SHAPE",
  ]);
  assert.deepEqual(Object.values(ApplicationBriefMatcherError.VALIDATION_CATEGORY), [
    "TEXT",
    "IDENTIFIER_ITEM_ID",
    "IDENTIFIER_FIELD",
  ]);
  assert.deepEqual(Object.values(ApplicationBriefMatcherError.VALIDATION_RULE), [
    "TEXT_NOT_STRING",
    "TEXT_BLANK",
    "TEXT_TOO_LONG",
    "ITEM_ID_NOT_STRING",
    "ITEM_ID_EMPTY",
    "ITEM_ID_TOO_LONG",
    "ITEM_ID_INVALID_CHARSET",
    "FIELD_NOT_STRING",
    "FIELD_UNKNOWN_SCALAR",
    "FIELD_INVALID_INDEXED_SYNTAX",
    "FIELD_KIND_INCOMPATIBLE",
    "FIELD_INDEX_OUT_OF_NORMATIVE_RANGE",
  ]);
  const cause = new Error("private cause");
  const error = new ApplicationBriefMatcherError(
    ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
    ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT,
    cause,
  );
  assert.equal(error.message, "INVALID_APPLICATION_BRIEF_OUTPUT");
  assert.equal(error.cause, cause);
  assert.deepEqual(error.safeDetails, {
    validationCode: null,
    validationSubcode: null,
  });
});

test("matcher error retains only coherent closed structural diagnostics", () => {
  const valid = new ApplicationBriefMatcherError(
    ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
    ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT,
    null,
    {
      validationCode: "SEMANTIC_VALIDATION",
      validationSubcode: "TEXT_OR_IDENTIFIER_FORMAT",
      validationPath: "supportedClaims[1].evidenceRefs[0].itemId",
      validationCategory: "IDENTIFIER_ITEM_ID",
      validationRule: "ITEM_ID_INVALID_CHARSET",
    },
  );
  assert.deepEqual(valid.safeDetails, {
    validationCode: "SEMANTIC_VALIDATION",
    validationSubcode: "TEXT_OR_IDENTIFIER_FORMAT",
    validationPath: "supportedClaims[1].evidenceRefs[0].itemId",
    validationCategory: "IDENTIFIER_ITEM_ID",
    validationRule: "ITEM_ID_INVALID_CHARSET",
  });

  const unsafe = new ApplicationBriefMatcherError(
    ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
    ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT,
    null,
    {
      validationCode: "SEMANTIC_VALIDATION",
      validationSubcode: "TEXT_OR_IDENTIFIER_FORMAT",
      validationPath: "supportedClaims[private].evidenceRefs[0].itemId",
      validationCategory: "IDENTIFIER_ITEM_ID",
      validationRule: "ITEM_ID_INVALID_CHARSET",
    },
  );
  assert.deepEqual(unsafe.safeDetails, {
    validationCode: "SEMANTIC_VALIDATION",
    validationSubcode: "TEXT_OR_IDENTIFIER_FORMAT",
  });
});

test("matcher error retains cardinality rules only for cardinality failures", () => {
  const valid = new ApplicationBriefMatcherError(
    ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
    ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT,
    null,
    {
      validationCode: "SEMANTIC_VALIDATION",
      validationSubcode: "CARDINALITY",
      cardinalityRule: "ROOT_SUPPORTED_CLAIMS_MAX",
    },
  );
  assert.deepEqual(valid.safeDetails, {
    validationCode: "SEMANTIC_VALIDATION",
    validationSubcode: "CARDINALITY",
    cardinalityRule: "ROOT_SUPPORTED_CLAIMS_MAX",
  });

  for (const safeDetails of [{
    validationCode: "SEMANTIC_VALIDATION",
    validationSubcode: "CARDINALITY",
    cardinalityRule: "private rule",
  }, {
    validationCode: "SEMANTIC_VALIDATION",
    validationSubcode: "ENUM",
    cardinalityRule: "ROOT_SUPPORTED_CLAIMS_MAX",
  }, {
    validationCode: "CONTEXTUAL_VALIDATION",
    validationSubcode: null,
    cardinalityRule: "ROOT_SUPPORTED_CLAIMS_MAX",
  }]) {
    const error = new ApplicationBriefMatcherError(
      ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
      ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT,
      null,
      safeDetails,
    );
    assert.equal(Object.hasOwn(error.safeDetails, "cardinalityRule"), false);
    assert.equal(Object.hasOwn(error.safeDetails, "nestedShapeRule"), false);
  }
});

test("matcher error retains nested-shape rules only for nested-shape failures", () => {
  const valid = new ApplicationBriefMatcherError(
    ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
    ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT,
    null,
    {
      validationCode: "SEMANTIC_VALIDATION",
      validationSubcode: "NESTED_SHAPE_OR_KEYS",
      nestedShapeRule: "SUPPORTED_CLAIM_SHAPE",
      cardinalityRule: "ROOT_SUPPORTED_CLAIMS_MAX",
    },
  );
  assert.deepEqual(valid.safeDetails, {
    validationCode: "SEMANTIC_VALIDATION",
    validationSubcode: "NESTED_SHAPE_OR_KEYS",
    nestedShapeRule: "SUPPORTED_CLAIM_SHAPE",
  });

  for (const safeDetails of [{
    validationCode: "SEMANTIC_VALIDATION",
    validationSubcode: "NESTED_SHAPE_OR_KEYS",
    nestedShapeRule: "private rule",
  }, {
    validationCode: "SEMANTIC_VALIDATION",
    validationSubcode: "ENUM",
    nestedShapeRule: "SUPPORTED_CLAIM_SHAPE",
  }, {
    validationCode: "CONTEXTUAL_VALIDATION",
    validationSubcode: null,
    nestedShapeRule: "SUPPORTED_CLAIM_SHAPE",
  }]) {
    const error = new ApplicationBriefMatcherError(
      ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
      ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT,
      null,
      safeDetails,
    );
    assert.equal(Object.hasOwn(error.safeDetails, "nestedShapeRule"), false);
  }
});
