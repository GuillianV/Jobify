/**
 * Stable business contract for the server-side offer preparation flow.
 */
class OfferPreparationConstants {
  static STATUS = Object.freeze({
    READY: "READY",
    NEEDS_PROVIDER_ACQUISITION: "NEEDS_PROVIDER_ACQUISITION",
    NEEDS_USER_TEXT: "NEEDS_USER_TEXT",
  });

  static PROVIDER_ACQUISITION_KIND = Object.freeze({
    HELLOWORK_DETAIL: "HELLOWORK_DETAIL",
  });
}

export { OfferPreparationConstants };
