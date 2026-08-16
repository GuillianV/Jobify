import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationBriefService } from "../../src/services/ApplicationBriefService.js";

const REQUESTED_OFFER_ID = 42;
const AUTHORITATIVE_OFFER_ID = 84;
const SHA_256_HEX_LENGTH = 64;

/**
 * Build one service harness with observable injected collaborators.
 * @param {object} [behavior] - Optional collaborator behavior.
 * @returns {object} Service, inputs, result, and captured calls.
 */
function createHarness(behavior = {}) {
  const calls = { analysis: [], candidate: 0, builder: [] };
  const analysis = { requirements: [] };
  const offerSnapshot = { offerId: AUTHORITATIVE_OFFER_ID, title: "Backend Engineer" };
  const identity = {
    offerId: AUTHORITATIVE_OFFER_ID,
    cacheKey: "a".repeat(SHA_256_HEX_LENGTH),
    schemaVersion: "offer-analysis-schema-v1",
    policyVersion: "offer-analyzer-policy-v1",
    provider: "private-provider",
  };
  const analysisResult = {
    analysis,
    identity,
    offerSnapshot,
    cacheHit: behavior.cacheHit ?? true,
    analyzer: { policyVersion: "wrong-policy", schemaVersion: "wrong-schema" },
  };
  const dossier = { schemaVersion: "candidate-dossier-schema-v1" };
  const candidateResult = { dossier, updatedAt: "private-timestamp" };
  const brief = { kind: "application-brief" };
  const offerAnalysisService = {
    async analyze(offerId) {
      calls.analysis.push(offerId);
      if (behavior.analysisError) {
        throw behavior.analysisError;
      }
      return analysisResult;
    },
  };
  const candidateDossierService = {
    get() {
      calls.candidate += 1;
      if (behavior.candidateError) {
        throw behavior.candidateError;
      }
      return candidateResult;
    },
  };
  const applicationBriefBuilder = {
    async build(inputs) {
      calls.builder.push(inputs);
      if (behavior.builderError) {
        throw behavior.builderError;
      }
      return brief;
    },
  };
  const service = new ApplicationBriefService({
    offerAnalysisService,
    candidateDossierService,
    applicationBriefBuilder,
  });
  return { service, calls, analysisResult, candidateResult, brief };
}

for (const cacheHit of [true, false]) {
  test(`service forwards authoritative inputs on cacheHit ${cacheHit}`, async () => {
    const harness = createHarness({ cacheHit });
    const analysisSnapshot = structuredClone(harness.analysisResult);
    const candidateSnapshot = structuredClone(harness.candidateResult);
    const result = await harness.service.generateForOffer(REQUESTED_OFFER_ID);

    assert.equal(result, harness.brief);
    assert.deepEqual(harness.calls.analysis, [REQUESTED_OFFER_ID]);
    assert.equal(harness.calls.candidate, 1);
    assert.equal(harness.calls.builder.length, 1);
    assert.deepEqual(harness.calls.builder[0], {
      offerAnalysis: harness.analysisResult.analysis,
      offerSnapshot: harness.analysisResult.offerSnapshot,
      offerIdentity: {
        offerId: AUTHORITATIVE_OFFER_ID,
        analysisFingerprint: harness.analysisResult.identity.cacheKey,
        analysisSchemaVersion: harness.analysisResult.identity.schemaVersion,
        analyzerPolicyVersion: harness.analysisResult.identity.policyVersion,
      },
      candidateDossier: harness.candidateResult.dossier,
    });
    assert.equal(harness.calls.builder[0].offerSnapshot, harness.analysisResult.offerSnapshot);
    assert.equal("updatedAt" in harness.calls.builder[0], false);
    assert.deepEqual(harness.analysisResult, analysisSnapshot);
    assert.deepEqual(harness.candidateResult, candidateSnapshot);
  });
}

test("service propagates collaborator failures without wrapping", async () => {
  for (const source of ["analysisError", "candidateError", "builderError"]) {
    const expected = new Error(source);
    const harness = createHarness({ [source]: expected });
    await assert.rejects(harness.service.generateForOffer(REQUESTED_OFFER_ID), (error) => {
      return error === expected;
    });
  }
});
