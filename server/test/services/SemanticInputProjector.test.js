import test from "node:test";
import assert from "node:assert/strict";
import { SemanticInputProjector } from "../../src/services/SemanticInputProjector.js";
import { DeduplicationConstants } from "../../src/constants/DeduplicationConstants.js";

/**
 * Build one lightweight semantic offer.
 * @param {object} values - Offer fields.
 * @returns {object} Semantic offer.
 */
function createOffer(values) {
  return {
    id: values.id,
    source: values.source,
    sourceId: values.sourceId,
    title: values.title,
    description: values.description,
    company: { name: values.company },
    location: { city: values.city },
    contractType: values.contractType,
  };
}

/**
 * Create an exact-format test projector.
 * @param {string} prompt - System prompt.
 * @returns {SemanticInputProjector} Projector.
 */
function createProjector(prompt = "system", policyVersion, snippetLength) {
  return new SemanticInputProjector(prompt, policyVersion, snippetLength);
}

test("semantic projection canonicalizes offer order without changing original mapping", () => {
  const projector = createProjector();
  const first = createOffer({ id: 1, source: "hellowork", sourceId: "b", title: "Zulu", description: "B", company: "Example", city: "Annecy", contractType: "CDI" });
  const second = createOffer({ id: 2, source: "adzuna", sourceId: "a", title: "Alpha", description: "A", company: "Example", city: "Annecy", contractType: "CDI" });

  const input = projector.build([first, second], { keywords: "Node" }, "model");

  assert.deepEqual(input.orderedOffers, [second, first]);
  assert.deepEqual(input.originalIndices, [1, 0]);
  assert.deepEqual(Object.keys(input.signature), [
    "policyVersion",
    "model",
    "systemPromptHash",
    "snippetLength",
    "keywords",
    "offers",
  ]);
});

test("semantic cache key changes with every effective policy or prompt input", () => {
  const offer = createOffer({ id: 1, source: "adzuna", sourceId: "a", title: "Developer", description: "Description", company: "Example", city: "Annecy", contractType: "CDI" });
  const base = createProjector().build([offer], { keywords: "Node" }, "model").cacheKey;

  assert.notEqual(
    createProjector().build([{ ...offer, title: "Engineer" }], { keywords: "Node" }, "model").cacheKey,
    base,
  );
  assert.notEqual(
    createProjector().build([offer], { keywords: "Java" }, "model").cacheKey,
    base,
  );
  assert.notEqual(
    createProjector().build([offer], { keywords: "Node" }, "other-model").cacheKey,
    base,
  );
  assert.notEqual(
    createProjector("changed-system").build([offer], { keywords: "Node" }, "model").cacheKey,
    base,
  );
  assert.notEqual(
    createProjector("system", "changed-policy")
      .build([offer], { keywords: "Node" }, "model").cacheKey,
    base,
  );
  const legacyPolicyInput = createProjector("system", "SEMANTIC_DEDUP_V1")
    .build([offer], { keywords: "Node" }, "model");
  assert.equal(
    createProjector().build([offer], { keywords: "Node" }, "model").signature.policyVersion,
    DeduplicationConstants.SEMANTIC_POLICY_VERSION,
  );
  assert.notEqual(legacyPolicyInput.cacheKey, base);
  assert.notEqual(
    createProjector("system", undefined, 1)
      .build([offer], { keywords: "Node" }, "model").cacheKey,
    base,
  );
});
