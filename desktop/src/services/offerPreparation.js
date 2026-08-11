import { OfferPreparationConstants } from "../constants/OfferPreparationConstants.js";

const PREPARE_STATUSES = new Set(Object.values(OfferPreparationConstants.PREPARE_STATUS));

/**
 * Tell whether a value is a non-array object.
 * @param {unknown} value - Candidate value.
 * @returns {boolean} True when the value is an object record.
 */
function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Tell whether a value is the supported provider acquisition instruction.
 * @param {unknown} value - Candidate instruction.
 * @returns {boolean} True when the renderer recognizes the instruction contract.
 */
function isProviderAcquisition(value) {
  return isObject(value)
    && value.kind === OfferPreparationConstants.PROVIDER_ACQUISITION_KIND.HELLOWORK_DETAIL
    && value.source === OfferPreparationConstants.PROVIDER_SOURCE.HELLOWORK
    && typeof value.url === "string"
    && Boolean(value.url);
}

/**
 * Validate one complete server preparation envelope without reproducing policy.
 * @param {unknown} payload - Parsed server payload.
 * @returns {object} Structurally valid preparation envelope.
 */
function validatePreparationEnvelope(payload) {
  if (!isObject(payload) || !PREPARE_STATUSES.has(payload.prepareStatus)) {
    throw new TypeError("Invalid preparation response");
  }
  if (!isObject(payload.evaluation) || !isObject(payload.offre)) {
    throw new TypeError("Invalid preparation response");
  }
  if (!Number.isSafeInteger(payload.offre.id) || payload.offre.id <= 0) {
    throw new TypeError("Invalid preparation response");
  }
  if (payload.userContent !== null) {
    const validUserContent = isObject(payload.userContent)
      && typeof payload.userContent.text === "string"
      && typeof payload.userContent.providedAt === "string"
      && !Number.isNaN(Date.parse(payload.userContent.providedAt));
    if (!validUserContent) {
      throw new TypeError("Invalid preparation response");
    }
  }
  if (payload.providerAcquisition !== null
    && !isProviderAcquisition(payload.providerAcquisition)) {
    throw new TypeError("Invalid preparation response");
  }
  return payload;
}

/**
 * Validate one renderer-originated positive persisted offer identifier.
 * @param {number} id - Candidate SQLite identifier.
 * @returns {void}
 */
function validateOfferId(id) {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new TypeError("Invalid offer id");
  }
}

/**
 * Request and validate one server preparation envelope.
 * @param {string} url - Preparation endpoint URL.
 * @param {object} options - Fetch options.
 * @param {Function} request - Injected fetch implementation.
 * @returns {Promise<object>} Validated preparation envelope.
 */
async function requestPreparation(url, options, request) {
  const response = await request(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return validatePreparationEnvelope(await response.json());
}

/**
 * Evaluate the current authoritative preparation state without persistence.
 * @param {number} id - Persisted offer identifier.
 * @param {Function} [request] - Injected fetch implementation.
 * @returns {Promise<object>} Server preparation envelope.
 */
async function prepareOffer(id, request = fetch) {
  validateOfferId(id);
  return requestPreparation(
    `${OfferPreparationConstants.SERVER_URL}${OfferPreparationConstants.OFFERS_ENDPOINT}/${id}${OfferPreparationConstants.PREPARE_PATH}`,
    { method: "POST" },
    request,
  );
}

/**
 * Persist explicit user text and return the server reevaluation envelope.
 * @param {number} id - Persisted offer identifier.
 * @param {string} text - User-provided content.
 * @param {Function} [request] - Injected fetch implementation.
 * @returns {Promise<object>} Server preparation envelope.
 */
async function submitUserContent(id, text, request = fetch) {
  validateOfferId(id);
  return requestPreparation(
    `${OfferPreparationConstants.SERVER_URL}${OfferPreparationConstants.OFFERS_ENDPOINT}/${id}${OfferPreparationConstants.USER_CONTENT_PATH}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    },
    request,
  );
}

/**
 * Persist one Electron-acquired provider DETAIL and return its reevaluation.
 * @param {number} id - Persisted offer identifier.
 * @param {object} detail - Acquired description and final source URL.
 * @param {Function} [request] - Injected fetch implementation.
 * @returns {Promise<object>} Server preparation envelope.
 */
async function persistProviderContent(id, detail, request = fetch) {
  validateOfferId(id);
  return requestPreparation(
    `${OfferPreparationConstants.SERVER_URL}${OfferPreparationConstants.OFFERS_ENDPOINT}/${id}${OfferPreparationConstants.CONTENT_PATH}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: detail?.description,
        sourceUrl: detail?.sourceUrl,
      }),
    },
    request,
  );
}

export {
  isProviderAcquisition,
  persistProviderContent,
  prepareOffer,
  submitUserContent,
  validatePreparationEnvelope,
};
