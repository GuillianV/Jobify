import { ApplicationBriefConstants } from "../constants/ApplicationBriefConstants.js";

const MATCH_STATES = new Set(Object.values(ApplicationBriefConstants.MATCH_STATE));
const CAUTION_KINDS = new Set(Object.values(ApplicationBriefConstants.CAUTION_KIND));

/**
 * Tell whether one value is a non-array object.
 * @param {unknown} value - Candidate value.
 * @returns {boolean} Whether the value is an object record.
 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate the minimal evidence reference shape required by desktop presentation.
 * @param {unknown} reference - Evidence reference candidate.
 * @returns {boolean} Whether the reference is safe to resolve.
 */
function isEvidenceReference(reference) {
  return isObject(reference)
    && typeof reference.kind === "string"
    && typeof reference.itemId === "string"
    && typeof reference.field === "string";
}

/**
 * Require one array of evidence references.
 * @param {unknown} references - Reference array candidate.
 * @returns {boolean} Whether every item has the minimal shape.
 */
function isEvidenceReferenceArray(references) {
  return Array.isArray(references) && references.every(isEvidenceReference);
}

/**
 * Build the canonical identity used to join an evidence reference to its fact.
 * @param {object} reference - Validated evidence reference.
 * @returns {string} Canonical evidence identity.
 */
function buildEvidenceReferenceKey(reference) {
  return `${reference.kind}:${reference.itemId}:${reference.field}`;
}

/**
 * Validate one server ApplicationBrief for the exact desktop rendering needs.
 * @param {unknown} brief - Brief candidate.
 * @returns {object} Detached valid brief.
 */
function validateApplicationBrief(brief) {
  if (!isObject(brief)) {
    throw new TypeError("Invalid application brief response");
  }
  const arrays = [
    "requirementMatches", "evidenceFacts", "emphasis", "supportedClaims", "cautions",
  ];
  if (!arrays.every((field) => {
    return Array.isArray(brief[field]);
  })) {
    throw new TypeError("Invalid application brief response");
  }
  const validMatches = brief.requirementMatches.every((match) => {
    return isObject(match)
      && MATCH_STATES.has(match.state)
      && Array.isArray(match.supportedFacets)
      && Array.isArray(match.notEvidencedFacets)
      && match.supportedFacets.every((facet) => {
        return isObject(facet)
          && typeof facet.text === "string"
          && isEvidenceReferenceArray(facet.evidenceRefs);
      })
      && match.notEvidencedFacets.every((facet) => {
        return isObject(facet) && typeof facet.text === "string";
      });
  });
  const factKeys = new Set();
  const validFacts = brief.evidenceFacts.every((fact) => {
    if (!isObject(fact)
      || !isEvidenceReference(fact.ref)
      || (typeof fact.value !== "string" && typeof fact.value !== "boolean")) {
      return false;
    }
    const key = buildEvidenceReferenceKey(fact.ref);
    if (factKeys.has(key)) {
      return false;
    }
    factKeys.add(key);
    return true;
  });
  const validEmphasis = brief.emphasis.every((item) => {
    return isObject(item)
      && Object.values(ApplicationBriefConstants.PRIORITY).includes(item.priority)
      && typeof item.relevanceReason === "string"
      && isEvidenceReferenceArray(item.evidenceRefs);
  });
  const validCautions = brief.cautions.every((item) => {
    return isObject(item)
      && CAUTION_KINDS.has(item.kind)
      && isEvidenceReferenceArray(item.evidenceRefs);
  });
  const referencedEvidence = [
    ...brief.requirementMatches.flatMap((match) => {
      if (!Array.isArray(match?.supportedFacets)) {
        return [];
      }
      return match.supportedFacets.flatMap((facet) => {
        return Array.isArray(facet?.evidenceRefs) ? facet.evidenceRefs : [];
      });
    }),
    ...brief.emphasis.flatMap((item) => {
      return Array.isArray(item?.evidenceRefs) ? item.evidenceRefs : [];
    }),
    ...brief.cautions.flatMap((item) => {
      return Array.isArray(item?.evidenceRefs) ? item.evidenceRefs : [];
    }),
  ];
  const validEvidenceLinks = referencedEvidence.every((reference) => {
    return isEvidenceReference(reference)
      && factKeys.has(buildEvidenceReferenceKey(reference));
  });
  if (!validMatches || !validFacts || !validEmphasis || !validCautions
    || !validEvidenceLinks) {
    throw new TypeError("Invalid application brief response");
  }
  return structuredClone(brief);
}

/**
 * Create one renderer-safe HTTP error from public response fields only.
 * @param {Response} response - Failed response.
 * @returns {Promise<Error>} Safe error.
 */
async function createApplicationBriefHttpError(response) {
  let code = null;
  try {
    const payload = await response.json();
    if (isObject(payload) && typeof payload.code === "string") {
      code = payload.code;
    }
  } catch {
    code = null;
  }
  const error = new Error("Application brief request failed");
  error.name = "ApplicationBriefHttpError";
  error.status = response.status;
  error.code = code;
  return error;
}

/**
 * Generate one ApplicationBrief without sending renderer-owned business data.
 * @param {number} offerId - Persisted server offer identifier.
 * @param {Function} [request] - Injected fetch-compatible request.
 * @param {AbortSignal} [signal] - Optional cancellation signal.
 * @returns {Promise<object>} Atomic validated brief and opaque generation token.
 */
async function generateApplicationBrief(offerId, request = fetch, signal = undefined) {
  if (!Number.isSafeInteger(offerId) || offerId <= 0) {
    throw new TypeError("Invalid offer id");
  }
  const response = await request(
    `${ApplicationBriefConstants.ENDPOINT_PREFIX}/${offerId}${ApplicationBriefConstants.ENDPOINT_PATH}`,
    { method: "POST", signal },
  );
  if (!response.ok) {
    throw await createApplicationBriefHttpError(response);
  }
  const payload = await response.json();
  if (!isObject(payload)
    || !isObject(payload.brief)
    || typeof payload.generationToken !== "string"
    || payload.generationToken.length === 0) {
    throw new TypeError("Invalid application brief response");
  }
  return {
    brief: validateApplicationBrief(payload.brief),
    generationToken: payload.generationToken,
  };
}

export {
  generateApplicationBrief,
  validateApplicationBrief,
};
