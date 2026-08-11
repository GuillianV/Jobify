/**
 * Execute one authoritative provider instruction through the Electron bridge.
 * @param {unknown} providerAcquisition - Server-provided acquisition instruction.
 * @param {Function|undefined} fetchDetail - Electron DETAIL bridge.
 * @returns {Promise<object>} Canonical ACQUIRED, NOT_FOUND or FAILED result.
 */
async function acquireProviderContent(providerAcquisition, fetchDetail) {
  if (!isProviderAcquisition(providerAcquisition) || typeof fetchDetail !== "function") {
    return { status: OfferPreparationConstants.IPC_STATUS.FAILED };
  }
  try {
    const result = await fetchDetail(providerAcquisition);
    if (result?.status === OfferPreparationConstants.IPC_STATUS.ACQUIRED
      && typeof result.detail?.description === "string"
      && typeof result.detail?.sourceUrl === "string") {
      return {
        status: OfferPreparationConstants.IPC_STATUS.ACQUIRED,
        detail: {
          description: result.detail.description,
          sourceUrl: result.detail.sourceUrl,
        },
      };
    }
    if (result?.status === OfferPreparationConstants.IPC_STATUS.NOT_FOUND) {
      return { status: OfferPreparationConstants.IPC_STATUS.NOT_FOUND };
    }
    return { status: OfferPreparationConstants.IPC_STATUS.FAILED };
  } catch {
    return { status: OfferPreparationConstants.IPC_STATUS.FAILED };
  }
}

/**
 * Replace exactly one offer in an API list using its persistent id.
 * @param {object[]} offers - Current API offers.
 * @param {object} enriched - Enriched API offer.
 * @returns {object[]} Updated list preserving unrelated observations.
 */
function replaceOfferById(offers, enriched) {
  return offers.map((offer) => {
    return offer.id === enriched.id ? enriched : offer;
  });
}

/**
 * Apply one enriched offer to React list and selection state without reviving stale selection.
 * @param {object} enriched - Enriched API offer.
 * @param {Function} setOffers - React offer-list state setter.
 * @param {Function} setSelectedOffer - React selected-offer state setter.
 * @returns {void}
 */
function applyEnrichedOffer(enriched, setOffers, setSelectedOffer) {
  setOffers((currentOffers) => {
    return replaceOfferById(currentOffers, enriched);
  });
  setSelectedOffer((currentOffer) => {
    return currentOffer?.id === enriched.id ? enriched : currentOffer;
  });
}

export {
  acquireProviderContent,
  applyEnrichedOffer,
  replaceOfferById,
};
import { OfferPreparationConstants } from "../constants/OfferPreparationConstants.js";
import { isProviderAcquisition } from "./offerPreparation.js";
