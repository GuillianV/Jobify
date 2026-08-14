import { CandidateDossierConstants } from "../constants/CandidateDossierConstants.js";

const ENDPOINT_URL = `${CandidateDossierConstants.SERVER_URL}${CandidateDossierConstants.ENDPOINT}`;

/**
 * Tell whether one value is a non-array object.
 * @param {unknown} value - Candidate value.
 * @returns {boolean} True for an object record.
 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate and detach the minimal public CandidateDossier envelope.
 * @param {unknown} payload - Parsed server response.
 * @returns {{dossier: object, updatedAt: string|null}} Detached envelope.
 */
function validateCandidateDossierEnvelope(payload) {
  const validUpdatedAt = payload?.updatedAt === null
    || typeof payload?.updatedAt === "string";
  if (!isObject(payload) || !isObject(payload.dossier) || !validUpdatedAt) {
    throw new TypeError("Invalid candidate dossier response");
  }
  return structuredClone({
    dossier: payload.dossier,
    updatedAt: payload.updatedAt,
  });
}

/**
 * Build one renderer-safe HTTP error from explicitly public response fields.
 * @param {Response} response - Failed HTTP response.
 * @returns {Promise<Error>} Safe renderer error.
 */
async function createCandidateDossierHttpError(response) {
  let code = null;
  try {
    const payload = await response.json();
    if (isObject(payload) && typeof payload.code === "string") {
      code = payload.code;
    }
  } catch {
    code = null;
  }
  const error = new Error("Candidate dossier request failed");
  error.name = "CandidateDossierHttpError";
  error.status = response.status;
  error.code = code;
  return error;
}

/**
 * Execute one CandidateDossier request and validate its successful envelope.
 * @param {object} options - Fetch options.
 * @param {Function} request - Injected fetch implementation.
 * @returns {Promise<{dossier: object, updatedAt: string|null}>} Validated envelope.
 */
async function requestCandidateDossier(options, request) {
  const response = await request(ENDPOINT_URL, options);
  if (!response.ok) {
    throw await createCandidateDossierHttpError(response);
  }
  return validateCandidateDossierEnvelope(await response.json());
}

/**
 * Load the one canonical CandidateDossier.
 * @param {Function} [request] - Injected fetch implementation.
 * @returns {Promise<{dossier: object, updatedAt: string|null}>} Server envelope.
 */
async function getCandidateDossier(request = fetch) {
  return requestCandidateDossier({ method: "GET" }, request);
}

/**
 * Atomically replace the one canonical CandidateDossier.
 * @param {object} dossier - Complete CandidateDossier payload.
 * @param {Function} [request] - Injected fetch implementation.
 * @returns {Promise<{dossier: object, updatedAt: string|null}>} Server envelope.
 */
async function saveCandidateDossier(dossier, request = fetch) {
  return requestCandidateDossier({
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dossier),
  }, request);
}

export {
  getCandidateDossier,
  saveCandidateDossier,
  validateCandidateDossierEnvelope,
};
