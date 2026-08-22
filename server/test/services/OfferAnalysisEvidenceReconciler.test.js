import test from "node:test";
import assert from "node:assert/strict";
import { OfferAnalysisConstants } from "../../src/constants/OfferAnalysisConstants.js";
import { OfferAnalysisEvidenceReconciler } from "../../src/services/OfferAnalysisEvidenceReconciler.js";

const EXPLICIT = OfferAnalysisConstants.ASSERTION.EXPLICIT;
const INFERRED = OfferAnalysisConstants.ASSERTION.INFERRED;

/**
 * Build one minimal reconciler input around an activity evidence value.
 * @param {string} evidenceText - Evidence candidate.
 * @param {string} [assertion] - Assertion kind.
 * @returns {object} Minimal analysis shape.
 */
function createAnalysis(evidenceText, assertion = EXPLICIT) {
  return {
    seniority: null,
    activities: [{
      value: "Activity",
      assertion,
      evidence: assertion === INFERRED ? evidenceText : { text: evidenceText },
    }],
    requirements: [],
    context: [],
    workConditions: { workMode: null, constraints: [] },
  };
}

/**
 * Build one explicit semantic item with detached shared evidence text.
 * @param {string} value - Synthetic semantic value.
 * @param {object} evidence - Evidence template.
 * @returns {object} Explicit semantic item.
 */
function createExplicitItem(value, evidence) {
  return { value, assertion: EXPLICIT, evidence: structuredClone(evidence) };
}

test("exact evidence remains unchanged in a detached result", () => {
  const source = "Alpha exact evidence.";
  const analysis = createAnalysis("exact evidence");
  const before = structuredClone(analysis);
  const result = new OfferAnalysisEvidenceReconciler().reconcile(analysis, source);

  assert.equal(result.changed, false);
  assert.deepEqual(result.analysis, before);
  assert.notEqual(result.analysis, analysis);
  assert.notEqual(result.analysis.activities[0], analysis.activities[0]);
  assert.deepEqual(analysis, before);
  assert.equal(source, "Alpha exact evidence.");
});

test("closed mechanical variants reconcile to exact unique source slices", () => {
  const cases = [
    ["Alpha\r\nBeta", "Alpha\nBeta"],
    ["Alpha\rBeta", "Alpha\nBeta"],
    ["Alpha\u00a0Beta", "Alpha Beta"],
    ["Alpha\t \nBeta", "Alpha Beta"],
    ["L\u2019offre", "L'offre"],
    ["\u00abOffre\u00bb", "\"Offre\""],
    ["Alpha\u2014Beta", "Alpha-Beta"],
    ["\u00c9lodie", "E\u0301lodie"],
  ];
  for (const [source, evidence] of cases) {
    const result = new OfferAnalysisEvidenceReconciler()
      .reconcile(createAnalysis(evidence), source);
    assert.equal(result.changed, true, `${source} / ${evidence}`);
    assert.equal(result.analysis.activities[0].evidence.text, source);
    assert.equal(source.includes(result.analysis.activities[0].evidence.text), true);
  }
});

test("zero ambiguous case and non-allowlisted punctuation matches remain unrepaired", () => {
  const cases = [
    ["3 jours de t\u00e9l\u00e9travail par semaine", "t\u00e9l\u00e9travail partiel"],
    ["Alpha\u00a0Beta puis Alpha\tBeta", "Alpha Beta"],
    ["React", "react"],
    ["Alpha: Beta", "Alpha Beta"],
    ["Alpha\u000bBeta", "Alpha Beta"],
  ];
  for (const [source, evidence] of cases) {
    const analysis = createAnalysis(evidence);
    const result = new OfferAnalysisEvidenceReconciler().reconcile(analysis, source);
    assert.equal(result.changed, false, `${source} / ${evidence}`);
    assert.equal(result.analysis.activities[0].evidence.text, evidence);
  }
});

test("inferred evidence is never reconciled", () => {
  const analysis = createAnalysis({ text: "Alpha Beta" }, INFERRED);
  const result = new OfferAnalysisEvidenceReconciler()
    .reconcile(analysis, "Alpha\u00a0Beta");

  assert.equal(result.changed, false);
  assert.deepEqual(result.analysis.activities[0].evidence, { text: "Alpha Beta" });
});

test("all six explicit evidence paths use the same conservative reconciliation", () => {
  const evidence = { text: "Alpha Beta" };
  const analysis = {
    seniority: {
      levels: [OfferAnalysisConstants.SENIORITY_LEVEL.SENIOR],
      assertion: EXPLICIT,
      evidence: structuredClone(evidence),
    },
    activities: [createExplicitItem("Activity", evidence)],
    requirements: [{
      ...createExplicitItem("Requirement", evidence),
      category: OfferAnalysisConstants.REQUIREMENT_CATEGORY.OTHER,
      importance: OfferAnalysisConstants.REQUIREMENT_IMPORTANCE.UNSPECIFIED,
    }],
    context: [{
      ...createExplicitItem("Context", evidence),
      category: OfferAnalysisConstants.CONTEXT_CATEGORY.DOMAIN,
    }],
    workConditions: {
      workMode: {
        mode: OfferAnalysisConstants.WORK_MODE.HYBRID,
        detail: null,
        assertion: EXPLICIT,
        evidence: structuredClone(evidence),
      },
      constraints: [{
        ...createExplicitItem("Constraint", evidence),
        category: OfferAnalysisConstants.CONSTRAINT_CATEGORY.SCHEDULE,
      }],
    },
  };
  const before = structuredClone(analysis);
  const source = "Alpha\u00a0Beta";
  const result = new OfferAnalysisEvidenceReconciler().reconcile(analysis, source);
  const items = [
    result.analysis.seniority,
    ...result.analysis.activities,
    ...result.analysis.requirements,
    ...result.analysis.context,
    result.analysis.workConditions.workMode,
    ...result.analysis.workConditions.constraints,
  ];

  assert.equal(result.changed, true);
  for (const reconciledItem of items) {
    assert.equal(reconciledItem.evidence.text, source);
    assert.equal(source.includes(reconciledItem.evidence.text), true);
  }
  assert.deepEqual(analysis, before);
});
