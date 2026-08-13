/**
 * Stable vocabulary for the CandidateDossier domain contract V1.
 */
class CandidateDossierConstants {
  static SCHEMA_VERSION = "candidate-dossier-schema-v1";

  static SKILL_CATEGORY = Object.freeze({
    TECHNICAL_SKILL: "TECHNICAL_SKILL",
    FUNCTIONAL_SKILL: "FUNCTIONAL_SKILL",
    TOOL_OR_TECHNOLOGY: "TOOL_OR_TECHNOLOGY",
  });
}

export { CandidateDossierConstants };
