import { CandidateDossierConstants } from "../constants/CandidateDossierConstants.js";

/**
 * Detached immutable collection of candidate facts explicitly supplied by the user.
 */
class CandidateDossier {
  /**
   * Create the unique official empty CandidateDossier V1 value.
   * @returns {CandidateDossier} Deeply immutable empty dossier.
   */
  static empty() {
    return new CandidateDossier({
      schemaVersion: CandidateDossierConstants.SCHEMA_VERSION,
      experiences: [],
      projects: [],
      skills: [],
      education: [],
      languages: [],
      softSkills: [],
    });
  }

  /**
   * Create a dossier from an already validated CandidateDossier V1 value.
   * @param {object} value - Validated candidate facts without derived information.
   */
  constructor(value) {
    const detached = structuredClone(value);
    this.schemaVersion = CandidateDossierConstants.SCHEMA_VERSION;
    this.experiences = detached.experiences;
    this.projects = detached.projects;
    this.skills = detached.skills;
    this.education = detached.education;
    this.languages = detached.languages;
    this.softSkills = detached.softSkills;
    this.deepFreeze(this);
  }

  /**
   * Return a detached factual representation of the dossier.
   * @returns {object} Independent CandidateDossier V1 value.
   */
  toJson() {
    return structuredClone({
      schemaVersion: this.schemaVersion,
      experiences: this.experiences,
      projects: this.projects,
      skills: this.skills,
      education: this.education,
      languages: this.languages,
      softSkills: this.softSkills,
    });
  }

  /**
   * Recursively freeze one detached JSON-compatible value.
   * @param {unknown} value - Value owned by this domain object.
   * @returns {unknown} The frozen value.
   */
  deepFreeze(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
      for (const child of Object.values(value)) {
        this.deepFreeze(child);
      }
      Object.freeze(value);
    }
    return value;
  }
}

export { CandidateDossier };
