import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationBriefConstants } from "../../src/constants/ApplicationBriefConstants.js";
import { ApplicationBriefLimits } from "../../src/constants/ApplicationBriefLimits.js";
import { ApplicationBrief } from "../../src/models/ApplicationBrief.js";

/**
 * Build one complete empty structurally valid brief value.
 * @returns {object} Empty ApplicationBrief value.
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

test("ApplicationBrief detaches freezes and preserves the exact root contract", () => {
  const input = createEmptyBrief();
  const expected = structuredClone(input);
  const brief = new ApplicationBrief(input);
  input.requirementMatches.push({ external: true });

  assert.deepEqual(brief.toJson(), expected);
  assert.equal(Object.isFrozen(brief), true);
  assert.equal(Object.isFrozen(brief.inputIdentity.offer), true);
  assert.equal(Object.isFrozen(brief.requirementMatches), true);
});

test("ApplicationBrief toJson is detached and does not mutate domain state", () => {
  const brief = new ApplicationBrief(createEmptyBrief());
  const first = brief.toJson();
  first.emphasis.push({ external: true });

  assert.deepEqual(brief.toJson(), createEmptyBrief());
  assert.notEqual(first, brief.toJson());
});
