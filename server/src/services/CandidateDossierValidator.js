import { CandidateDossierConstants } from "../constants/CandidateDossierConstants.js";
import { CandidateDossierLimits } from "../constants/CandidateDossierLimits.js";
import { CandidateDossier } from "../models/CandidateDossier.js";
import { CandidateDossierValidationError } from "./CandidateDossierValidationError.js";

const ROOT_KEYS = Object.freeze([
  "schemaVersion", "experiences", "projects", "skills", "education", "languages", "softSkills",
]);
const EXPERIENCE_KEYS = Object.freeze([
  "id", "role", "organization", "client", "startDate", "endDate", "current", "domain",
  "activities", "achievements", "technologies",
]);
const PROJECT_KEYS = Object.freeze([
  "id", "name", "role", "startDate", "endDate", "domain", "summary", "activities",
  "achievements", "technologies",
]);
const SKILL_KEYS = Object.freeze(["id", "category", "value", "detail"]);
const EDUCATION_KEYS = Object.freeze([
  "id", "diploma", "level", "field", "institution", "startDate", "endDate",
]);
const LANGUAGE_KEYS = Object.freeze([
  "id", "language", "overall", "reading", "writing", "speaking", "listening",
]);
const SOFT_SKILL_KEYS = Object.freeze(["id", "value", "detail"]);
const ID_PATTERN = /^[A-Za-z0-9_-]+$/u;
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/u;

/**
 * Validates and materializes the strict CandidateDossier V1 contract without inference.
 */
class CandidateDossierValidator {
  /**
   * Validate one complete candidate dossier and return its immutable domain object.
   * @param {unknown} candidate - Untrusted dossier candidate.
   * @returns {CandidateDossier} Validated detached candidate facts.
   */
  validate(candidate) {
    this.requireExactObject(candidate, ROOT_KEYS, "dossier");
    if (candidate.schemaVersion !== CandidateDossierConstants.SCHEMA_VERSION) {
      this.fail("INVALID_INVARIANT", "CandidateDossier schema version is invalid");
    }
    this.validateCollection(candidate.experiences, CandidateDossierLimits.MAXIMUM_EXPERIENCES, "experiences", (item) => {
      this.validateExperience(item);
    });
    this.validateCollection(candidate.projects, CandidateDossierLimits.MAXIMUM_PROJECTS, "projects", (item) => {
      this.validateProject(item);
    });
    this.validateCollection(candidate.skills, CandidateDossierLimits.MAXIMUM_SKILLS, "skills", (item) => {
      this.validateSkill(item);
    });
    this.validateCollection(candidate.education, CandidateDossierLimits.MAXIMUM_EDUCATION_ITEMS, "education", (item) => {
      this.validateEducation(item);
    });
    this.validateCollection(candidate.languages, CandidateDossierLimits.MAXIMUM_LANGUAGES, "languages", (item) => {
      this.validateLanguage(item);
    });
    this.validateCollection(candidate.softSkills, CandidateDossierLimits.MAXIMUM_SOFT_SKILLS, "softSkills", (item) => {
      this.validateSoftSkill(item);
    });
    return new CandidateDossier(candidate);
  }

  /**
   * Validate one experience fact.
   * @param {object} item - Experience candidate.
   * @returns {void}
   */
  validateExperience(item) {
    this.requireExactObject(item, EXPERIENCE_KEYS, "experience");
    this.validateId(item.id);
    this.validateText(item.role);
    this.validateText(item.organization);
    this.validateNullableText(item.client);
    this.validateNullableText(item.domain);
    if (typeof item.current !== "boolean") {
      this.fail("INVALID_STRUCTURE", "Experience current must be boolean");
    }
    this.validateDateRange(item.startDate, item.endDate);
    if (item.current && item.endDate !== null) {
      this.fail("INVALID_INVARIANT", "Current experience end date must be null");
    }
    this.validateTextArray(item.activities, CandidateDossierLimits.MAXIMUM_ACTIVITIES);
    this.validateTextArray(item.achievements, CandidateDossierLimits.MAXIMUM_ACHIEVEMENTS);
    this.validateTextArray(item.technologies, CandidateDossierLimits.MAXIMUM_TECHNOLOGIES);
  }

  /**
   * Validate one project fact.
   * @param {object} item - Project candidate.
   * @returns {void}
   */
  validateProject(item) {
    this.requireExactObject(item, PROJECT_KEYS, "project");
    this.validateId(item.id);
    this.validateText(item.name);
    this.validateNullableText(item.role);
    this.validateNullableText(item.domain);
    this.validateNullableText(item.summary, CandidateDossierLimits.MAXIMUM_SUMMARY_LENGTH);
    this.validateDateRange(item.startDate, item.endDate);
    this.validateTextArray(item.activities, CandidateDossierLimits.MAXIMUM_ACTIVITIES);
    this.validateTextArray(item.achievements, CandidateDossierLimits.MAXIMUM_ACHIEVEMENTS);
    this.validateTextArray(item.technologies, CandidateDossierLimits.MAXIMUM_TECHNOLOGIES);
  }

  /**
   * Validate one categorized skill fact.
   * @param {object} item - Skill candidate.
   * @returns {void}
   */
  validateSkill(item) {
    this.requireExactObject(item, SKILL_KEYS, "skill");
    this.validateId(item.id);
    if (!Object.values(CandidateDossierConstants.SKILL_CATEGORY).includes(item.category)) {
      throw new CandidateDossierValidationError({
        validationCode: CandidateDossierValidationError.CODE.INVALID_ENUM,
        validationSubcode: CandidateDossierValidationError.ENUM_SUBCODE.SKILL_CATEGORY,
        message: "Candidate skill category is invalid",
      });
    }
    this.validateText(item.value);
    this.validateNullableText(item.detail);
  }

  /**
   * Validate one education fact.
   * @param {object} item - Education candidate.
   * @returns {void}
   */
  validateEducation(item) {
    this.requireExactObject(item, EDUCATION_KEYS, "education");
    this.validateId(item.id);
    this.validateText(item.diploma);
    this.validateNullableText(item.level);
    this.validateNullableText(item.field);
    this.validateNullableText(item.institution);
    this.validateDateRange(item.startDate, item.endDate);
  }

  /**
   * Validate one language fact without normalizing declared levels.
   * @param {object} item - Language candidate.
   * @returns {void}
   */
  validateLanguage(item) {
    this.requireExactObject(item, LANGUAGE_KEYS, "language");
    this.validateId(item.id);
    this.validateText(item.language);
    for (const field of ["overall", "reading", "writing", "speaking", "listening"]) {
      this.validateNullableText(item[field]);
    }
  }

  /**
   * Validate one explicitly declared soft-skill fact.
   * @param {object} item - Soft-skill candidate.
   * @returns {void}
   */
  validateSoftSkill(item) {
    this.requireExactObject(item, SOFT_SKILL_KEYS, "softSkill");
    this.validateId(item.id);
    this.validateText(item.value);
    this.validateNullableText(item.detail);
  }

  /**
   * Validate a bounded collection and ensure its item identifiers are unique locally.
   * @param {unknown} value - Collection candidate.
   * @param {number} maximum - Maximum number of items.
   * @param {string} label - Safe collection label.
   * @param {Function} validateItem - Item validator.
   * @returns {void}
   */
  validateCollection(value, maximum, label, validateItem) {
    if (!Array.isArray(value)) {
      this.fail("INVALID_STRUCTURE", `${label} must be an array`);
    }
    if (value.length > maximum) {
      this.fail("LIMIT_EXCEEDED", `${label} exceeds its limit`);
    }
    const ids = new Set();
    for (const item of value) {
      validateItem(item);
      if (ids.has(item.id)) {
        this.fail("DUPLICATE_ID", `${label} contains a duplicate id`);
      }
      ids.add(item.id);
    }
  }

  /**
   * Validate one caller-supplied stable item identifier.
   * @param {unknown} value - ID candidate.
   * @returns {void}
   */
  validateId(value) {
    if (typeof value !== "string" || !value.trim()
      || value.length > CandidateDossierLimits.MAXIMUM_ID_LENGTH
      || !ID_PATTERN.test(value)) {
      this.fail("INVALID_ID", "Candidate item id is invalid");
    }
  }

  /**
   * Validate one required bounded factual string.
   * @param {unknown} value - Required text.
   * @param {number} [maximum] - Limit.
   * @returns {void}
   */
  validateText(value, maximum = CandidateDossierLimits.MAXIMUM_TEXT_LENGTH) {
    if (typeof value !== "string" || !value.trim()) {
      this.fail("INVALID_TEXT", "Candidate text is invalid");
    }
    if (value.length > maximum) {
      this.fail("LIMIT_EXCEEDED", "Candidate text exceeds its limit");
    }
  }

  /**
   * Validate one explicitly nullable factual string.
   * @param {unknown} value - Nullable text.
   * @param {number} [maximum] - Limit.
   * @returns {void}
   */
  validateNullableText(value, maximum = CandidateDossierLimits.MAXIMUM_TEXT_LENGTH) {
    if (value !== null) {
      this.validateText(value, maximum);
    }
  }

  /**
   * Validate one bounded array of factual strings.
   * @param {unknown} value - Text array.
   * @param {number} maximum - Limit.
   * @returns {void}
   */
  validateTextArray(value, maximum) {
    if (!Array.isArray(value)) {
      this.fail("INVALID_STRUCTURE", "Candidate fact list must be an array");
    }
    if (value.length > maximum) {
      this.fail("LIMIT_EXCEEDED", "Candidate fact list exceeds its limit");
    }
    for (const text of value) {
      this.validateText(text);
    }
  }

  /**
   * Validate one optional chronological month range.
   * @param {unknown} startDate - Nullable start month.
   * @param {unknown} endDate - Nullable end month.
   * @returns {void}
   */
  validateDateRange(startDate, endDate) {
    this.validateNullableDate(startDate);
    this.validateNullableDate(endDate);
    if (startDate !== null && endDate !== null && endDate < startDate) {
      this.fail("INVALID_DATE", "Candidate date range is invalid");
    }
  }

  /**
   * Validate one nullable calendar month without deriving a duration.
   * @param {unknown} value - Nullable YYYY-MM candidate.
   * @returns {void}
   */
  validateNullableDate(value) {
    if (value !== null && (typeof value !== "string" || !MONTH_PATTERN.test(value))) {
      this.fail("INVALID_DATE", "Candidate date must use YYYY-MM");
    }
  }

  /**
   * Require an object with exactly the expected keys.
   * @param {unknown} value - Object candidate.
   * @param {string[]} keys - Exact keys.
   * @param {string} label - Safe label.
   * @returns {void}
   */
  requireExactObject(value, keys, label) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      this.fail("INVALID_STRUCTURE", `${label} must be an object`);
    }
    const actual = Object.keys(value);
    if (actual.some((key) => {
      return !keys.includes(key);
    })) {
      this.fail("UNKNOWN_FIELD", `${label} contains an unknown field`);
    }
    if (actual.length !== keys.length) {
      this.fail("INVALID_STRUCTURE", `${label} requires every field`);
    }
  }

  /**
   * Throw one controlled CandidateDossier contract violation.
   * @param {string} code - Safe error code key.
   * @param {string} message - Controlled message.
   * @returns {never}
   */
  fail(code, message) {
    throw new CandidateDossierValidationError({
      validationCode: CandidateDossierValidationError.CODE[code],
      message,
    });
  }
}

export { CandidateDossierValidator };
