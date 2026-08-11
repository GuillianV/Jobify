/**
 * Stable renderer contracts for server preparation and provider acquisition.
 */
class OfferPreparationConstants {
  static SERVER_URL = "http://localhost:3001";

  static OFFERS_ENDPOINT = "/api/offres";

  static PREPARE_PATH = "/prepare";

  static USER_CONTENT_PATH = "/contenu-utilisateur";

  static CONTENT_PATH = "/contenu";

  static PREPARE_STATUS = Object.freeze({
    READY: "READY",
    NEEDS_PROVIDER_ACQUISITION: "NEEDS_PROVIDER_ACQUISITION",
    NEEDS_USER_TEXT: "NEEDS_USER_TEXT",
  });

  static PROVIDER_ACQUISITION_KIND = Object.freeze({
    HELLOWORK_DETAIL: "HELLOWORK_DETAIL",
  });

  static PROVIDER_SOURCE = Object.freeze({
    HELLOWORK: "hellowork",
  });

  static IPC_STATUS = Object.freeze({
    ACQUIRED: "ACQUIRED",
    NOT_FOUND: "NOT_FOUND",
    FAILED: "FAILED",
  });

  static UI_STATUS = Object.freeze({
    IDLE: "idle",
    PREPARING: "preparing",
    ACQUIRING_PROVIDER_CONTENT: "acquiringProviderContent",
    NEEDS_USER_TEXT: "needsUserText",
    READY: "ready",
    ERROR: "error",
  });

  static RETRY_KIND = Object.freeze({
    PREPARE: "prepare",
    PROVIDER: "provider",
    PERSIST_PROVIDER: "persistProvider",
    USER_TEXT: "userText",
  });

  static ERROR_KIND = Object.freeze({
    PREPARE: "prepare",
    PROVIDER: "provider",
    PERSIST_PROVIDER: "persistProvider",
    USER_TEXT: "userText",
  });

  static MAXIMUM_USER_TEXT_LENGTH = 100000;

  static MESSAGE = Object.freeze({
    PREPARE_FAILED: "La préparation de cette offre a échoué. Vous pouvez réessayer.",
    PROVIDER_FAILED: "La récupération automatique du contenu a échoué. Vous pouvez réessayer ou coller le texte complet de l'annonce.",
    PERSIST_PROVIDER_FAILED: "L'enregistrement du contenu récupéré a échoué. Vous pouvez réessayer sans relancer la récupération.",
    USER_TEXT_FAILED: "L'enregistrement de votre texte a échoué. Vous pouvez réessayer.",
  });
}

export { OfferPreparationConstants };
