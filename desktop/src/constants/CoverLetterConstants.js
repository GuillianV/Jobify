import { OfferPreparationConstants } from "./OfferPreparationConstants.js";

/**
 * Stable desktop transport and orchestration contracts for CoverLetter generation.
 */
class CoverLetterConstants {
  static ENDPOINT_PATH = "/cover-letter";

  static ENDPOINT_PREFIX = `${OfferPreparationConstants.SERVER_URL}${OfferPreparationConstants.OFFERS_ENDPOINT}`;

  static SCHEMA_VERSION = "cover-letter-schema-v1";

  static REFRESH_REQUIRED_CODE = "APPLICATION_BRIEF_REFRESH_REQUIRED";

  static UI_STATUS = Object.freeze({
    IDLE: "idle",
    LOADING: "loading",
    SUCCESS: "success",
    ERROR: "error",
  });
}

export { CoverLetterConstants };
