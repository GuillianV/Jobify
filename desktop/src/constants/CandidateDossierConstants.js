/**
 * Stable renderer contracts for the singleton CandidateDossier UI.
 */
class CandidateDossierConstants {
  static SERVER_URL = "http://localhost:3001";

  static ENDPOINT = "/api/dossier-candidat";

  static SCHEMA_VERSION = "candidate-dossier-schema-v1";

  static SKILL_CATEGORY = Object.freeze({
    TECHNICAL_SKILL: "TECHNICAL_SKILL",
    FUNCTIONAL_SKILL: "FUNCTIONAL_SKILL",
    TOOL_OR_TECHNOLOGY: "TOOL_OR_TECHNOLOGY",
  });

  static SKILL_CATEGORY_LABEL = Object.freeze({
    TECHNICAL_SKILL: "Compétence technique",
    FUNCTIONAL_SKILL: "Compétence fonctionnelle",
    TOOL_OR_TECHNOLOGY: "Outil / technologie",
  });

  static LOAD_STATUS = Object.freeze({
    LOADING: "loading",
    READY: "ready",
    ERROR: "error",
  });

  static SAVE_STATUS = Object.freeze({
    IDLE: "idle",
    SAVING: "saving",
    ERROR: "error",
  });

  static ERROR_CODE = Object.freeze({
    INVALID_DOSSIER: "INVALID_CANDIDATE_DOSSIER",
    PERSISTENCE: "CANDIDATE_DOSSIER_PERSISTENCE_ERROR",
    INTERNAL: "INTERNAL_SERVER_ERROR",
  });

  /**
   * Renderer copies of backend limits needed for lightweight editor feedback.
   */
  static LIMIT = Object.freeze({
    EXPERIENCES: 20,
    PROJECTS: 20,
    SKILLS: 50,
    EDUCATION: 10,
    LANGUAGES: 10,
    SOFT_SKILLS: 20,
    ACTIVITIES: 20,
    ACHIEVEMENTS: 20,
    TECHNOLOGIES: 30,
    TEXT_LENGTH: 240,
    SUMMARY_LENGTH: 1000,
    SUMMARY_TECHNOLOGIES: 3,
  });
}

export { CandidateDossierConstants };
