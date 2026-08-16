import { OfferPreparationConstants } from "./OfferPreparationConstants.js";

/**
 * Stable desktop contracts for on-demand ApplicationBrief generation and presentation.
 */
class ApplicationBriefConstants {
  static ENDPOINT_PATH = "/application-brief";

  static ENDPOINT_PREFIX = `${OfferPreparationConstants.SERVER_URL}${OfferPreparationConstants.OFFERS_ENDPOINT}`;

  static UI_STATUS = Object.freeze({
    IDLE: "idle",
    LOADING: "loading",
    SUCCESS: "success",
    ERROR: "error",
  });

  static MATCH_STATE = Object.freeze({
    SUPPORTED: "SUPPORTED",
    PARTIALLY_SUPPORTED: "PARTIALLY_SUPPORTED",
    NOT_EVIDENCED: "NOT_EVIDENCED",
  });

  static PRIORITY = Object.freeze({
    PRIMARY: "PRIMARY",
    SECONDARY: "SECONDARY",
  });

  static CAUTION_KIND = Object.freeze({
    EXPERTISE_LEVEL_UNSUPPORTED: "EXPERTISE_LEVEL_UNSUPPORTED",
    DURATION_UNSUPPORTED: "DURATION_UNSUPPORTED",
    LEADERSHIP_UNSUPPORTED: "LEADERSHIP_UNSUPPORTED",
    LANGUAGE_LEVEL_UNSUPPORTED: "LANGUAGE_LEVEL_UNSUPPORTED",
    SCOPE_GENERALIZATION_UNSUPPORTED: "SCOPE_GENERALIZATION_UNSUPPORTED",
  });

  static HTTP_STATUS = Object.freeze({
    BAD_GATEWAY: 502,
    SERVICE_UNAVAILABLE: 503,
  });

  static MESSAGE = Object.freeze({
    GENERIC_ERROR: "Impossible d’analyser la candidature pour le moment.",
    OFFER_NOT_READY: "Préparez d’abord le contenu complet de l’offre.",
    INPUT_TOO_LARGE: "Le contenu à analyser est trop volumineux pour le moment.",
    TEMPORARILY_UNAVAILABLE: "Le service d’analyse est temporairement indisponible. Réessayez plus tard.",
    ANALYSIS_FAILED: "L’analyse n’a pas pu être finalisée correctement. Vous pouvez réessayer.",
    STALE_INPUT: "Les données utilisées pour l’analyse ont changé. Relancez l’analyse.",
  });
}

export { ApplicationBriefConstants };
