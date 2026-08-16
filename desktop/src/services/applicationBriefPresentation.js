import { ApplicationBriefConstants } from "../constants/ApplicationBriefConstants.js";

const MATCH_STATE_LABELS = Object.freeze({
  [ApplicationBriefConstants.MATCH_STATE.SUPPORTED]: "Étayé par votre dossier",
  [ApplicationBriefConstants.MATCH_STATE.PARTIALLY_SUPPORTED]: "Partiellement étayé",
  [ApplicationBriefConstants.MATCH_STATE.NOT_EVIDENCED]: "Non documenté dans votre dossier",
});
const PRIORITY_LABELS = Object.freeze({
  [ApplicationBriefConstants.PRIORITY.PRIMARY]: "À mettre en avant en priorité",
  [ApplicationBriefConstants.PRIORITY.SECONDARY]: "Complément utile",
});
const CAUTION_MESSAGES = Object.freeze({
  [ApplicationBriefConstants.CAUTION_KIND.EXPERTISE_LEVEL_UNSUPPORTED]:
    "Le niveau d’expertise demandé n’est pas documenté par les éléments de votre dossier.",
  [ApplicationBriefConstants.CAUTION_KIND.DURATION_UNSUPPORTED]:
    "La durée d’expérience demandée n’est pas documentée par les éléments de votre dossier.",
  [ApplicationBriefConstants.CAUTION_KIND.LEADERSHIP_UNSUPPORTED]:
    "Une expérience de leadership demandée n’est pas documentée dans votre dossier.",
  [ApplicationBriefConstants.CAUTION_KIND.LANGUAGE_LEVEL_UNSUPPORTED]:
    "Le niveau de langue demandé n’est pas documenté dans votre dossier.",
  [ApplicationBriefConstants.CAUTION_KIND.SCOPE_GENERALIZATION_UNSUPPORTED]:
    "Les éléments du dossier ne permettent pas d’étayer tout le périmètre demandé.",
});

/**
 * Build one collision-free key for a validated evidence reference.
 * @param {object} reference - Validated reference.
 * @returns {string} Canonical lookup key.
 */
function buildEvidenceRefKey(reference) {
  return `${reference.kind}:${reference.itemId}:${reference.field}`;
}

/**
 * Build an immutable-use lookup from authoritative evidence facts.
 * @param {object[]} evidenceFacts - Validated evidence facts.
 * @returns {Map<string, string|boolean>} Fact lookup.
 */
function buildEvidenceFactLookup(evidenceFacts) {
  return new Map(evidenceFacts.map((fact) => {
    return [buildEvidenceRefKey(fact.ref), fact.value];
  }));
}

/**
 * Format one exact evidence value without exposing technical representation.
 * @param {string|boolean} value - Resolved evidence value.
 * @returns {string} User-facing factual value.
 */
function formatEvidenceValue(value) {
  if (typeof value === "boolean") {
    return value ? "Oui" : "Non";
  }
  return value;
}

/**
 * Resolve and stably deduplicate visible values for evidence references.
 * @param {object[]} references - Validated evidence references.
 * @param {Map<string, string|boolean>} lookup - Evidence lookup.
 * @returns {string[]} User-visible values.
 */
function resolveEvidenceValues(references, lookup) {
  const values = new Set();
  for (const reference of references) {
    const value = lookup.get(buildEvidenceRefKey(reference));
    if (value !== undefined) {
      values.add(formatEvidenceValue(value));
    }
  }
  return [...values];
}

/**
 * Build the user-facing model without mutating or exposing technical references.
 * @param {object} brief - Validated ApplicationBrief.
 * @returns {object} Detached presentation model.
 */
function buildApplicationBriefPresentation(brief) {
  const lookup = buildEvidenceFactLookup(brief.evidenceFacts);
  return {
    requirementMatches: brief.requirementMatches.map((match, matchIndex) => {
      return {
        key: `match-${matchIndex}`,
        stateLabel: MATCH_STATE_LABELS[match.state],
        supportedFacets: match.supportedFacets.map((facet, facetIndex) => {
          return {
            key: `supported-${matchIndex}-${facetIndex}`,
            text: facet.text,
            evidenceValues: resolveEvidenceValues(facet.evidenceRefs, lookup),
          };
        }),
        notEvidencedFacets: match.notEvidencedFacets.map((facet, facetIndex) => {
          return {
            key: `not-evidenced-${matchIndex}-${facetIndex}`,
            text: facet.text,
          };
        }),
      };
    }),
    emphasis: brief.emphasis.map((item, index) => {
      return {
        key: `emphasis-${index}`,
        priorityLabel: PRIORITY_LABELS[item.priority],
        relevanceReason: item.relevanceReason,
        evidenceValues: resolveEvidenceValues(item.evidenceRefs, lookup),
      };
    }),
    cautions: brief.cautions.map((item, index) => {
      return {
        key: `caution-${index}`,
        message: CAUTION_MESSAGES[item.kind],
      };
    }),
    hasEvidence: brief.evidenceFacts.length > 0,
  };
}

/**
 * Resolve one stable local error message from public HTTP status and code only.
 * @param {{status: number|null, code: string|null}|null} error - Safe error details.
 * @returns {string} Localized user message.
 */
function getApplicationBriefErrorMessage(error) {
  if (error?.code === "OFFER_NOT_READY") {
    return ApplicationBriefConstants.MESSAGE.OFFER_NOT_READY;
  }
  if (error?.code === "ANALYZER_INPUT_TOO_LARGE"
    || error?.code === "APPLICATION_BRIEF_INPUT_TOO_LARGE") {
    return ApplicationBriefConstants.MESSAGE.INPUT_TOO_LARGE;
  }
  if (error?.code === "APPLICATION_BRIEF_STALE_INPUT") {
    return ApplicationBriefConstants.MESSAGE.STALE_INPUT;
  }
  if (error?.status === ApplicationBriefConstants.HTTP_STATUS.SERVICE_UNAVAILABLE) {
    return ApplicationBriefConstants.MESSAGE.TEMPORARILY_UNAVAILABLE;
  }
  if (error?.status === ApplicationBriefConstants.HTTP_STATUS.BAD_GATEWAY) {
    return ApplicationBriefConstants.MESSAGE.ANALYSIS_FAILED;
  }
  return ApplicationBriefConstants.MESSAGE.GENERIC_ERROR;
}

export {
  buildApplicationBriefPresentation,
  buildEvidenceFactLookup,
  buildEvidenceRefKey,
  getApplicationBriefErrorMessage,
  resolveEvidenceValues,
};
