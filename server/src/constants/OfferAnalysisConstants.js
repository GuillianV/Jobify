/**
 * Stable vocabulary for the OfferAnalysis semantic contract V1.
 */
class OfferAnalysisConstants {
  static SCHEMA_VERSION = "offer-analysis-schema-v1";

  static ASSERTION = Object.freeze({
    EXPLICIT: "EXPLICIT",
    INFERRED: "INFERRED",
  });

  static REQUIREMENT_CATEGORY = Object.freeze({
    TECHNICAL_SKILL: "TECHNICAL_SKILL",
    FUNCTIONAL_SKILL: "FUNCTIONAL_SKILL",
    TOOL_OR_TECHNOLOGY: "TOOL_OR_TECHNOLOGY",
    SOFT_SKILL: "SOFT_SKILL",
    EXPERIENCE: "EXPERIENCE",
    EDUCATION: "EDUCATION",
    LANGUAGE: "LANGUAGE",
    OTHER: "OTHER",
  });

  static REQUIREMENT_IMPORTANCE = Object.freeze({
    REQUIRED: "REQUIRED",
    PREFERRED: "PREFERRED",
    UNSPECIFIED: "UNSPECIFIED",
  });

  static SENIORITY_LEVEL = Object.freeze({
    JUNIOR: "JUNIOR",
    CONFIRMED: "CONFIRMED",
    SENIOR: "SENIOR",
    LEAD: "LEAD",
    MANAGER: "MANAGER",
  });

  static CONTEXT_CATEGORY = Object.freeze({
    DOMAIN: "DOMAIN",
    TEAM: "TEAM",
    CHALLENGE: "CHALLENGE",
  });

  static WORK_MODE = Object.freeze({
    REMOTE: "REMOTE",
    HYBRID: "HYBRID",
    ONSITE: "ONSITE",
  });

  static CONSTRAINT_CATEGORY = Object.freeze({
    TRAVEL: "TRAVEL",
    SCHEDULE: "SCHEDULE",
    OPERATIONAL: "OPERATIONAL",
  });

  static EFFECTIVE_CONTENT_ORIGIN = Object.freeze({
    USER: "USER",
    AUTOMATIC: "AUTOMATIC",
  });
}

export { OfferAnalysisConstants };
