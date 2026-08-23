import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationBriefConstants } from "../../src/constants/ApplicationBriefConstants.js";
import { ApplicationBriefSemanticJsonSchema } from "../../src/constants/ApplicationBriefSemanticJsonSchema.js";

const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "anyOf",
]);

/**
 * Resolve the strict ApplicationBrief semantic schema under test.
 * @returns {object} JSON Schema object.
 */
function createSchema() {
  const responseFormat = ApplicationBriefSemanticJsonSchema.createResponseFormat();
  assert.equal(responseFormat.type, "json_schema");
  assert.equal(
    responseFormat.json_schema.name,
    ApplicationBriefSemanticJsonSchema.NAME,
  );
  assert.equal(responseFormat.json_schema.name, "application_brief_semantic_v1");
  assert.equal(responseFormat.json_schema.strict, true);
  return responseFormat.json_schema.schema;
}

/**
 * Audit schema keywords and strict object closure recursively.
 * @param {object} schema - Schema node to audit.
 * @param {Set<string>} keywords - Observed schema keywords.
 * @returns {void}
 */
function auditSchema(schema, keywords) {
  for (const keyword of Object.keys(schema)) {
    assert.equal(SUPPORTED_SCHEMA_KEYWORDS.has(keyword), true);
    keywords.add(keyword);
  }
  if (schema.type === "object") {
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, Object.keys(schema.properties));
    for (const propertySchema of Object.values(schema.properties)) {
      auditSchema(propertySchema, keywords);
    }
  }
  if (schema.items !== undefined) {
    auditSchema(schema.items, keywords);
  }
  if (schema.anyOf !== undefined) {
    for (const branch of schema.anyOf) {
      auditSchema(branch, keywords);
    }
  }
}

test("schema closes the exact required semantic root", () => {
  const schema = createSchema();
  const rootKeys = ["requirementMatches", "emphasis", "supportedClaims", "cautions"];
  assert.equal(schema.type, "object");
  assert.deepEqual(Object.keys(schema.properties), rootKeys);
  assert.deepEqual(schema.required, rootKeys);
  assert.equal(schema.additionalProperties, false);
});

test("schema recursively uses only the proven subset and closes every object", () => {
  const keywords = new Set();
  auditSchema(createSchema(), keywords);
  assert.deepEqual(keywords, SUPPORTED_SCHEMA_KEYWORDS);
});

test("schema matches every nested semantic shape and canonical enum", () => {
  const schema = createSchema();
  const requirementMatch = schema.properties.requirementMatches.items;
  const supportedFacet = requirementMatch.properties.supportedFacets.items;
  const notEvidencedFacet = requirementMatch.properties.notEvidencedFacets.items;
  const emphasis = schema.properties.emphasis.items;
  const supportedClaim = schema.properties.supportedClaims.items;
  const caution = schema.properties.cautions.items;
  const evidenceReference = supportedFacet.properties.evidenceRefs.items;

  assert.deepEqual(Object.keys(requirementMatch.properties), [
    "offerRef", "state", "supportedFacets", "notEvidencedFacets",
  ]);
  assert.deepEqual(Object.keys(supportedFacet.properties), ["text", "evidenceRefs"]);
  assert.deepEqual(Object.keys(notEvidencedFacet.properties), ["text"]);
  assert.deepEqual(Object.keys(emphasis.properties), [
    "priority", "offerRefs", "evidenceRefs", "relevanceReason",
  ]);
  assert.deepEqual(Object.keys(supportedClaim.properties), [
    "claimType", "offerRefs", "evidenceRefs",
  ]);
  assert.deepEqual(Object.keys(caution.properties), ["kind", "offerRefs", "evidenceRefs"]);
  assert.deepEqual(Object.keys(evidenceReference.properties), ["kind", "itemId", "field"]);
  assert.deepEqual(
    requirementMatch.properties.state.enum,
    Object.values(ApplicationBriefConstants.EVIDENCE_STATE),
  );
  assert.deepEqual(emphasis.properties.priority.enum, Object.values(ApplicationBriefConstants.PRIORITY));
  assert.deepEqual(
    supportedClaim.properties.claimType.enum,
    Object.values(ApplicationBriefConstants.CLAIM_TYPE),
  );
  assert.deepEqual(caution.properties.kind.enum, Object.values(ApplicationBriefConstants.CAUTION_KIND));
  assert.deepEqual(
    evidenceReference.properties.kind.enum,
    Object.values(ApplicationBriefConstants.EVIDENCE_KIND),
  );
});

test("schema distinguishes requirement and generic offer reference variants", () => {
  const schema = createSchema();
  const requirementReference = schema.properties.requirementMatches
    .items.properties.offerRef;
  assert.deepEqual(requirementReference.required, ["kind", "index"]);
  assert.deepEqual(requirementReference.properties.kind.enum, [
    ApplicationBriefConstants.OFFER_REF_KIND.REQUIREMENT,
  ]);
  assert.equal(requirementReference.properties.index.type, "integer");

  const variants = schema.properties.emphasis.items.properties.offerRefs.items.anyOf;
  assert.equal(variants.length, 2);
  assert.deepEqual(variants[0].required, ["kind", "index"]);
  assert.deepEqual(variants[0].properties.kind.enum, [
    ApplicationBriefConstants.OFFER_REF_KIND.REQUIREMENT,
    ApplicationBriefConstants.OFFER_REF_KIND.ACTIVITY,
    ApplicationBriefConstants.OFFER_REF_KIND.CONTEXT,
  ]);
  assert.equal(variants[0].properties.index.type, "integer");
  assert.deepEqual(variants[1].required, ["kind"]);
  assert.deepEqual(variants[1].properties.kind.enum, [
    ApplicationBriefConstants.OFFER_REF_KIND.SENIORITY,
  ]);
  assert.equal(Object.hasOwn(variants[1].properties, "index"), false);
});
