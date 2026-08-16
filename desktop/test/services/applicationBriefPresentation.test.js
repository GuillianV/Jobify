import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationBriefConstants } from "../../src/constants/ApplicationBriefConstants.js";
import {
  buildApplicationBriefPresentation,
  buildEvidenceFactLookup,
  buildEvidenceRefKey,
  getApplicationBriefErrorMessage,
  resolveEvidenceValues,
} from "../../src/services/applicationBriefPresentation.js";

/**
 * Build one evidence reference.
 * @param {string} field - Evidence field.
 * @returns {object} Reference fixture.
 */
function createRef(field = "technologies[0]") {
  return { kind: "PROJECT", itemId: "project-1", field };
}

/**
 * Build one non-trivial brief fixture.
 * @returns {object} Brief fixture.
 */
function createBrief() {
  const reference = createRef();
  return {
    requirementMatches: [
      {
        state: "SUPPORTED",
        supportedFacets: [{ text: "React", evidenceRefs: [reference] }],
        notEvidencedFacets: [],
      },
      {
        state: "PARTIALLY_SUPPORTED",
        supportedFacets: [{ text: "Node.js", evidenceRefs: [reference] }],
        notEvidencedFacets: [{ text: "cinq ans d’expérience" }],
      },
      {
        state: "NOT_EVIDENCED",
        supportedFacets: [],
        notEvidencedFacets: [{ text: "anglais courant" }],
      },
    ],
    evidenceFacts: [{ ref: reference, value: "React" }],
    emphasis: [{
      priority: "PRIMARY",
      relevanceReason: "Cette technologie est centrale pour le poste.",
      evidenceRefs: [reference],
    }],
    supportedClaims: [{ claimType: "PROJECT_FACT" }],
    cautions: Object.values(ApplicationBriefConstants.CAUTION_KIND).map((kind) => {
      return { kind, evidenceRefs: [] };
    }),
  };
}

test("evidence lookup resolves values without exposing reference strings", () => {
  const reference = createRef();
  const lookup = buildEvidenceFactLookup([{ ref: reference, value: "React" }]);
  assert.equal(lookup.get(buildEvidenceRefKey(reference)), "React");
  assert.deepEqual(resolveEvidenceValues([reference, reference], lookup), ["React"]);
});

test("presentation maps all states priorities and cautions to fixed French text", () => {
  const presentation = buildApplicationBriefPresentation(createBrief());
  assert.deepEqual(presentation.requirementMatches.map((match) => {
    return match.stateLabel;
  }), [
    "Étayé par votre dossier",
    "Partiellement étayé",
    "Non documenté dans votre dossier",
  ]);
  assert.equal(presentation.emphasis[0].priorityLabel, "À mettre en avant en priorité");
  assert.equal(
    presentation.emphasis[0].relevanceReason,
    "Cette technologie est centrale pour le poste.",
  );
  assert.equal(presentation.cautions.length, Object.values(
    ApplicationBriefConstants.CAUTION_KIND,
  ).length);
  for (const caution of presentation.cautions) {
    assert.equal(typeof caution.message, "string");
    assert.equal(caution.message.includes("UNSUPPORTED"), false);
  }
});

test("presentation shows supported facts and never carries technical refs or claims", () => {
  const presentation = buildApplicationBriefPresentation(createBrief());
  assert.deepEqual(
    presentation.requirementMatches[0].supportedFacets[0].evidenceValues,
    ["React"],
  );
  const serialized = JSON.stringify(presentation);
  for (const technical of [
    "PROJECT", "project-1", "technologies[0]", "SUPPORTED", "PROJECT_FACT",
  ]) {
    assert.equal(serialized.includes(technical), false);
  }
});

test("empty candidate and empty requirements produce stable presentation states", () => {
  const emptyCandidate = createBrief();
  emptyCandidate.evidenceFacts = [];
  emptyCandidate.requirementMatches[0].supportedFacets[0].evidenceRefs = [];
  const candidatePresentation = buildApplicationBriefPresentation(emptyCandidate);
  assert.equal(candidatePresentation.hasEvidence, false);
  assert.deepEqual(
    candidatePresentation.requirementMatches[0].supportedFacets[0].evidenceValues,
    [],
  );

  const emptyRequirements = createBrief();
  emptyRequirements.requirementMatches = [];
  assert.deepEqual(
    buildApplicationBriefPresentation(emptyRequirements).requirementMatches,
    [],
  );
});

test("error presentation uses public status and code without backend messages", () => {
  assert.equal(
    getApplicationBriefErrorMessage({ status: 409, code: "OFFER_NOT_READY" }),
    ApplicationBriefConstants.MESSAGE.OFFER_NOT_READY,
  );
  assert.equal(
    getApplicationBriefErrorMessage({ status: 422, code: "APPLICATION_BRIEF_INPUT_TOO_LARGE" }),
    ApplicationBriefConstants.MESSAGE.INPUT_TOO_LARGE,
  );
  assert.equal(
    getApplicationBriefErrorMessage({ status: 409, code: "APPLICATION_BRIEF_STALE_INPUT" }),
    ApplicationBriefConstants.MESSAGE.STALE_INPUT,
  );
  assert.equal(
    getApplicationBriefErrorMessage({ status: 503, code: "PRIVATE" }),
    ApplicationBriefConstants.MESSAGE.TEMPORARILY_UNAVAILABLE,
  );
  assert.equal(
    getApplicationBriefErrorMessage({ status: 502, code: null }),
    ApplicationBriefConstants.MESSAGE.ANALYSIS_FAILED,
  );
  assert.equal(
    getApplicationBriefErrorMessage({ status: 500, code: null }),
    ApplicationBriefConstants.MESSAGE.GENERIC_ERROR,
  );
});
