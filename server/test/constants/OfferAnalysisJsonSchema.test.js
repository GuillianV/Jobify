import test from "node:test";
import assert from "node:assert/strict";
import { OfferAnalysisConstants } from "../../src/constants/OfferAnalysisConstants.js";
import { OfferAnalysisJsonSchema } from "../../src/constants/OfferAnalysisJsonSchema.js";

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
 * Resolve the strict OfferAnalysis schema under test.
 * @returns {object} JSON Schema object.
 */
function createSchema() {
  const responseFormat = OfferAnalysisJsonSchema.createResponseFormat();
  assert.equal(responseFormat.type, "json_schema");
  assert.equal(responseFormat.json_schema.name, OfferAnalysisJsonSchema.NAME);
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

test("schema closes the exact required root and required nullable branches", () => {
  const schema = createSchema();
  assert.equal(schema.type, "object");
  assert.deepEqual(schema.required, [
    "seniority", "activities", "requirements", "context", "workConditions",
  ]);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties), schema.required);
  assert.deepEqual(schema.properties.seniority.anyOf.at(-1), { type: "null" });
  assert.deepEqual(
    schema.properties.workConditions.properties.workMode.anyOf.at(-1),
    { type: "null" },
  );
  assert.deepEqual(schema.properties.workConditions.required, ["workMode", "constraints"]);
});

test("schema reuses canonical enums and explicit-only contracts", () => {
  const schema = createSchema();
  const seniority = schema.properties.seniority.anyOf[0];
  const activity = schema.properties.activities.items;
  const requirement = schema.properties.requirements.items;
  const context = schema.properties.context.items;
  const workConditions = schema.properties.workConditions;
  const workMode = workConditions.properties.workMode.anyOf[0];
  const constraint = workConditions.properties.constraints.items;

  assert.deepEqual(
    seniority.properties.levels.items.enum,
    Object.values(OfferAnalysisConstants.SENIORITY_LEVEL),
  );
  assert.deepEqual(activity.properties.assertion.enum, Object.values(OfferAnalysisConstants.ASSERTION));
  assert.deepEqual(
    requirement.properties.category.enum,
    Object.values(OfferAnalysisConstants.REQUIREMENT_CATEGORY),
  );
  assert.deepEqual(
    requirement.properties.importance.enum,
    Object.values(OfferAnalysisConstants.REQUIREMENT_IMPORTANCE),
  );
  assert.deepEqual(context.properties.category.enum, Object.values(OfferAnalysisConstants.CONTEXT_CATEGORY));
  assert.deepEqual(workMode.properties.mode.enum, Object.values(OfferAnalysisConstants.WORK_MODE));
  assert.deepEqual(
    constraint.properties.category.enum,
    Object.values(OfferAnalysisConstants.CONSTRAINT_CATEGORY),
  );
  const explicitOnly = [requirement, workMode, constraint];
  for (const item of explicitOnly) {
    assert.deepEqual(item.properties.assertion.enum, [OfferAnalysisConstants.ASSERTION.EXPLICIT]);
  }
});

test("schema closes evidence while retaining semantic validation responsibilities", () => {
  const schema = createSchema();
  const activity = schema.properties.activities.items;
  const evidence = activity.properties.evidence.anyOf[0];
  assert.equal(evidence.additionalProperties, false);
  assert.deepEqual(evidence.required, ["text"]);
  assert.deepEqual(activity.properties.evidence.anyOf.at(-1), { type: "null" });
});

test("schema recursively uses only the documented subset and closes every object", () => {
  const schema = createSchema();
  const keywords = new Set();
  auditSchema(schema, keywords);
  assert.deepEqual(keywords, SUPPORTED_SCHEMA_KEYWORDS);
});
