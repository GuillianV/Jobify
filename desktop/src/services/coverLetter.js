import { CoverLetterConstants } from "../constants/CoverLetterConstants.js";

/**
 * Tell whether one value is a non-array object.
 * @param {unknown} value - Candidate value.
 * @returns {boolean} Whether the value is an object record.
 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Require the minimal atomic ApplicationBrief result used by transport.
 * @param {unknown} result - Atomic brief and opaque token candidate.
 * @returns {void}
 */
function validateApplicationBriefResult(result) {
  if (!isObject(result)
    || !isObject(result.brief)
    || typeof result.generationToken !== "string"
    || result.generationToken.length === 0) {
    throw new TypeError("Invalid application brief result");
  }
}

/**
 * Create one renderer-safe HTTP error from public response fields only.
 * @param {Response} response - Failed response.
 * @returns {Promise<Error>} Safe error.
 */
async function createCoverLetterHttpError(response) {
  let code = null;
  try {
    const payload = await response.json();
    if (isObject(payload) && typeof payload.code === "string") {
      code = payload.code;
    }
  } catch {
    code = null;
  }
  const error = new Error("Cover letter request failed");
  error.name = "CoverLetterHttpError";
  error.status = response.status;
  error.code = code;
  return error;
}

/**
 * Validate and detach the exact CoverLetter fields required by the desktop.
 * @param {unknown} coverLetter - Response candidate.
 * @returns {object} Detached transport-safe CoverLetter.
 */
function validateCoverLetter(coverLetter) {
  if (!isObject(coverLetter)
    || coverLetter.schemaVersion !== CoverLetterConstants.SCHEMA_VERSION
    || typeof coverLetter.letter !== "string"
    || coverLetter.letter.length === 0
    || !Array.isArray(coverLetter.usedClaimIndexes)
    || !coverLetter.usedClaimIndexes.every((index) => {
      return Number.isSafeInteger(index) && index >= 0;
    })) {
    throw new TypeError("Invalid cover letter response");
  }
  return {
    schemaVersion: coverLetter.schemaVersion,
    letter: coverLetter.letter,
    usedClaimIndexes: [...coverLetter.usedClaimIndexes],
  };
}

/**
 * Generate one CoverLetter from an exact atomic ApplicationBrief result.
 * @param {number} offerId - Persisted server offer identifier.
 * @param {object} applicationBriefResult - Validated brief and opaque token pair.
 * @param {Function} [request] - Injected fetch-compatible request.
 * @param {AbortSignal} [signal] - Optional cancellation signal.
 * @returns {Promise<object>} Detached minimally validated CoverLetter.
 */
async function generateCoverLetter(
  offerId,
  applicationBriefResult,
  request = fetch,
  signal = undefined,
) {
  if (!Number.isSafeInteger(offerId) || offerId <= 0) {
    throw new TypeError("Invalid offer id");
  }
  validateApplicationBriefResult(applicationBriefResult);
  const response = await request(
    `${CoverLetterConstants.ENDPOINT_PREFIX}/${offerId}${CoverLetterConstants.ENDPOINT_PATH}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brief: applicationBriefResult.brief,
        generationToken: applicationBriefResult.generationToken,
      }),
      signal,
    },
  );
  if (!response.ok) {
    throw await createCoverLetterHttpError(response);
  }
  const payload = await response.json();
  if (!isObject(payload) || !isObject(payload.coverLetter)) {
    throw new TypeError("Invalid cover letter response");
  }
  return validateCoverLetter(payload.coverLetter);
}

export { generateCoverLetter, validateCoverLetter };
