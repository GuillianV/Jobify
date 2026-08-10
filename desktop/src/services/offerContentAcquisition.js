/**
 * Tell whether the current API observation requires HelloWork DETAIL acquisition.
 * @param {object} offer - API offer.
 * @param {Function|undefined} fetchDetail - Electron DETAIL bridge.
 * @returns {boolean} True when acquisition can be attempted.
 */
function shouldAcquireOfferDetail(offer, fetchDetail) {
  return Number.isSafeInteger(offer?.id)
    && !offer.description
    && Boolean(offer.applyUrl)
    && typeof fetchDetail === "function";
}

/**
 * Acquire provider DETAIL and persist it through the authoritative server API.
 * @param {object} offer - API offer to enrich.
 * @param {Function} fetchDetail - Electron DETAIL bridge.
 * @param {Function} persistDetail - Server persistence callback.
 * @returns {Promise<object|null>} Enriched API offer or null when DETAIL is absent.
 */
async function acquireOfferDetail(offer, fetchDetail, persistDetail) {
  const detail = await fetchDetail({ source: offer.source, url: offer.applyUrl });
  if (!detail) {
    return null;
  }
  return persistDetail(offer.id, detail);
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
  acquireOfferDetail,
  applyEnrichedOffer,
  replaceOfferById,
  shouldAcquireOfferDetail,
};
