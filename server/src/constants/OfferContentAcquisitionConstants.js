import { OfferContentLimits } from "./OfferContentLimits.js";

/**
 * Validation limits for automatic offer-content acquisition.
 */
class OfferContentAcquisitionConstants {
  static MAXIMUM_DETAIL_DESCRIPTION_LENGTH = OfferContentLimits.MAXIMUM_TEXT_LENGTH;

  static HELLOWORK_ORIGIN = "https://www.hellowork.com";
}

export { OfferContentAcquisitionConstants };
