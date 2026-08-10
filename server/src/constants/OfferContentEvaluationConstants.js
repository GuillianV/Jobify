/**
 * Stable contract and locally calibrated thresholds for offer-content sufficiency V1.
 */
class OfferContentEvaluationConstants {
  static POLICY_VERSION = "offer-content-sufficiency-v1";

  static STATUS = Object.freeze({
    SUFFICIENT: "SUFFICIENT",
    INSUFFICIENT: "INSUFFICIENT",
    UNDETERMINED: "UNDETERMINED",
  });

  static REASON = Object.freeze({
    MISSING_TEXT: "MISSING_TEXT",
    TOO_SHORT: "TOO_SHORT",
    PLACEHOLDER_CONTENT: "PLACEHOLDER_CONTENT",
    HIGHLY_REPETITIVE: "HIGHLY_REPETITIVE",
    INTERMEDIATE_CONTENT: "INTERMEDIATE_CONTENT",
    SUFFICIENT_TEXT_VOLUME: "SUFFICIENT_TEXT_VOLUME",
  });

  static TEXT_SOURCE = Object.freeze({
    USER: "USER",
    AUTOMATIC: "AUTOMATIC",
    NONE: "NONE",
  });

  static LOW_CHARACTER_COUNT = 300;

  static LOW_WORD_COUNT = 40;

  static LOW_DISTINCT_WORD_COUNT = 30;

  static HIGH_CHARACTER_COUNT = 800;

  static HIGH_WORD_COUNT = 120;

  static HIGH_DISTINCT_WORD_COUNT = 80;

  static FIVE_GRAM_SIZE = 5;

  static HIGH_REPETITION_SHARE = 0.8;

  static PLACEHOLDERS = Object.freeze([
    "description non disponible",
    "description indisponible",
    "contenu non disponible",
    "contenu indisponible",
    "voir l'annonce",
    "consulter l'annonce",
    "voir l'offre",
    "consulter l'offre",
    "cliquez ici pour voir l'annonce",
  ]);
}

export { OfferContentEvaluationConstants };
