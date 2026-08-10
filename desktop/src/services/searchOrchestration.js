/**
 * Claim the initial automatic search once across repeated StrictMode effect setup.
 * @param {{current: boolean}} didRunInitialSearch - Persistent React ref.
 * @returns {boolean} True only for the first caller.
 */
function claimInitialSearch(didRunInitialSearch) {
  if (didRunInitialSearch.current) {
    return false;
  }
  didRunInitialSearch.current = true;
  return true;
}

/**
 * Run one search while allowing only the latest request to update visible state.
 * @param {object} params - Search orchestration dependencies.
 * @param {{current: number}} params.requestIdRef - Monotonic request id ref.
 * @param {Function} params.search - Complete asynchronous search operation.
 * @param {Function} params.setOffers - Offer-list state setter.
 * @param {Function} params.setStatus - Search-status state setter.
 * @param {Function} params.setError - Search-error state setter.
 * @param {string} params.loadingStatus - Loading status value.
 * @param {string} params.successStatus - Successful status value.
 * @param {string} params.errorStatus - Failed status value.
 * @returns {Promise<void>} Resolves after the request becomes settled or stale.
 */
async function runLatestSearch({
  requestIdRef,
  search,
  setOffers,
  setStatus,
  setError,
  loadingStatus,
  successStatus,
  errorStatus,
}) {
  requestIdRef.current += 1;
  const requestId = requestIdRef.current;
  setStatus(loadingStatus);
  setError(null);
  try {
    const offers = await search();
    if (requestId !== requestIdRef.current) {
      return;
    }
    setOffers(offers);
    setStatus(successStatus);
  } catch (caught) {
    if (requestId !== requestIdRef.current) {
      return;
    }
    setError(caught.message);
    setStatus(errorStatus);
  }
}

export { claimInitialSearch, runLatestSearch };
