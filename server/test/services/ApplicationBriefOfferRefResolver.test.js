import test from "node:test";
import assert from "node:assert/strict";
import { OfferAnalysis } from "../../src/models/OfferAnalysis.js";
import { ApplicationBriefContextValidationError } from "../../src/services/ApplicationBriefContextValidationError.js";
import { ApplicationBriefOfferRefResolver } from "../../src/services/ApplicationBriefOfferRefResolver.js";

const SECOND_INDEX = ["first", "second"].length - 1;

/**
 * Build one offer analysis containing every resolvable offer fact kind.
 * @returns {OfferAnalysis} Offer analysis fixture.
 */
function createAnalysis() {
  return new OfferAnalysis({
    seniority: { levels: ["SENIOR"], assertion: "EXPLICIT", evidence: { text: "Senior" } },
    activities: [
      { value: "First activity", assertion: "EXPLICIT", evidence: { text: "First" } },
      { value: "Second activity", assertion: "INFERRED", evidence: null },
    ],
    requirements: [
      {
        category: "OTHER", value: "First requirement", importance: "REQUIRED",
        assertion: "EXPLICIT", evidence: { text: "First requirement" },
      },
    ],
    context: [
      { category: "DOMAIN", value: "Context", assertion: "INFERRED", evidence: null },
    ],
    workConditions: { workMode: null, constraints: [] },
  });
}

/**
 * Assert the closed invalid offer reference reason.
 * @param {Function} action - Failing resolver call.
 * @returns {void}
 */
function expectInvalidOfferRef(action) {
  assert.throws(action, (error) => {
    assert.equal(error instanceof ApplicationBriefContextValidationError, true);
    assert.equal(
      error.reason,
      ApplicationBriefContextValidationError.REASON.INVALID_OFFER_REFERENCE,
    );
    return true;
  });
}

test("offer resolver returns detached exact facts for every kind", () => {
  const analysis = createAnalysis();
  const snapshot = analysis.toJson();
  const resolver = new ApplicationBriefOfferRefResolver();
  const requirement = resolver.resolve(analysis, { kind: "REQUIREMENT", index: 0 });
  const activity = resolver.resolve(analysis, { kind: "ACTIVITY", index: SECOND_INDEX });
  const context = resolver.resolve(analysis, { kind: "CONTEXT", index: 0 });
  const seniority = resolver.resolve(analysis, { kind: "SENIORITY" });

  assert.deepEqual(requirement, snapshot.requirements[0]);
  assert.deepEqual(activity, snapshot.activities[SECOND_INDEX]);
  assert.deepEqual(context, snapshot.context[0]);
  assert.deepEqual(seniority, snapshot.seniority);
  requirement.value = "Changed";
  seniority.levels.push("LEAD");
  assert.deepEqual(analysis.toJson(), snapshot);
});

test("offer resolver rejects length larger indexes and absent seniority", () => {
  const analysis = createAnalysis();
  const resolver = new ApplicationBriefOfferRefResolver();
  expectInvalidOfferRef(() => {
    resolver.resolve(analysis, { kind: "REQUIREMENT", index: analysis.requirements.length });
  });
  expectInvalidOfferRef(() => {
    resolver.resolve(analysis, { kind: "ACTIVITY", index: analysis.activities.length + 1 });
  });
  const withoutSeniority = new OfferAnalysis({ ...analysis.toJson(), seniority: null });
  expectInvalidOfferRef(() => {
    resolver.resolve(withoutSeniority, { kind: "SENIORITY" });
  });
});
