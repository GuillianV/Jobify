import { OfferAnalysisConstants } from "../constants/OfferAnalysisConstants.js";
import { OfferAnalysisLimits } from "../constants/OfferAnalysisLimits.js";
import { OfferAnalysis } from "../models/OfferAnalysis.js";

const ROOT_KEYS = Object.freeze([
  "seniority",
  "activities",
  "requirements",
  "context",
  "workConditions",
]);
const ANALYSIS_ITEM_KEYS = Object.freeze(["value", "assertion", "evidence"]);
const REQUIREMENT_KEYS = Object.freeze([
  "category",
  "value",
  "importance",
  "assertion",
  "evidence",
]);
const CATEGORIZED_ITEM_KEYS = Object.freeze([
  "category",
  "value",
  "assertion",
  "evidence",
]);
const SENIORITY_KEYS = Object.freeze(["levels", "assertion", "evidence"]);
const WORK_CONDITIONS_KEYS = Object.freeze(["workMode", "constraints"]);
const WORK_MODE_KEYS = Object.freeze(["mode", "detail", "assertion", "evidence"]);
const EVIDENCE_KEYS = Object.freeze(["text"]);

/**
 * Validates, normalizes and materializes the strict OfferAnalysis V1 contract.
 */
class OfferAnalysisValidator {
  /**
   * Create the validator with its predictable normalization policy.
   * @param {import("./OfferAnalysisNormalizer.js").OfferAnalysisNormalizer} normalizer - Normalizer.
   */
  constructor(normalizer) {
    this.normalizer = normalizer;
  }

  /**
   * Validate raw structure, normalize synthetic fields and enforce final invariants.
   * @param {unknown} candidate - Untrusted analysis candidate.
   * @param {string} effectiveText - Exact authoritative offer text.
   * @returns {OfferAnalysis} Detached validated analysis.
   */
  validate(candidate, effectiveText) {
    if (typeof effectiveText !== "string" || !effectiveText) {
      throw new TypeError("OfferAnalysis validation requires effective text");
    }
    this.validateRawStructure(candidate);
    this.validateTotal(candidate);
    const normalized = this.normalizer.normalize(candidate);
    this.validateFinalInvariants(normalized, effectiveText);
    this.validateTotal(normalized);
    return new OfferAnalysis(normalized);
  }

  /**
   * Validate the complete raw object shape before any normalization.
   * @param {unknown} candidate - Untrusted analysis candidate.
   * @returns {void}
   */
  validateRawStructure(candidate) {
    this.requireExactObject(candidate, ROOT_KEYS, "analysis");
    this.validateSeniorityStructure(candidate.seniority);
    this.validateArray(candidate.activities, OfferAnalysisLimits.MAXIMUM_ACTIVITIES, "activities");
    for (const item of candidate.activities) {
      this.validateAnalysisItemStructure(item, "activity");
    }
    this.validateArray(
      candidate.requirements,
      OfferAnalysisLimits.MAXIMUM_REQUIREMENTS,
      "requirements",
    );
    for (const item of candidate.requirements) {
      this.validateRequirementStructure(item);
    }
    this.validateArray(candidate.context, OfferAnalysisLimits.MAXIMUM_CONTEXT_ITEMS, "context");
    for (const item of candidate.context) {
      this.validateContextStructure(item);
    }
    this.validateWorkConditionsStructure(candidate.workConditions);
  }

  /**
   * Validate one nullable seniority object.
   * @param {unknown} seniority - Raw seniority.
   * @returns {void}
   */
  validateSeniorityStructure(seniority) {
    if (seniority === null) {
      return;
    }
    this.requireExactObject(seniority, SENIORITY_KEYS, "seniority");
    this.validateArray(
      seniority.levels,
      OfferAnalysisLimits.MAXIMUM_SENIORITY_LEVELS,
      "seniority levels",
    );
    if (seniority.levels.length === 0) {
      throw new TypeError("Seniority levels must not be empty");
    }
    for (const level of seniority.levels) {
      this.requireEnum(level, OfferAnalysisConstants.SENIORITY_LEVEL, "seniority level");
    }
    this.validateAssertionStructure(seniority.assertion, seniority.evidence, true);
  }

  /**
   * Validate one activity structure.
   * @param {unknown} item - Raw activity.
   * @param {string} label - Diagnostic label.
   * @returns {void}
   */
  validateAnalysisItemStructure(item, label) {
    this.requireExactObject(item, ANALYSIS_ITEM_KEYS, label);
    this.validateSyntheticString(item.value, OfferAnalysisLimits.MAXIMUM_VALUE_LENGTH, label);
    this.validateAssertionStructure(item.assertion, item.evidence, true);
  }

  /**
   * Validate one explicit requirement structure.
   * @param {unknown} item - Raw requirement.
   * @returns {void}
   */
  validateRequirementStructure(item) {
    this.requireExactObject(item, REQUIREMENT_KEYS, "requirement");
    this.requireEnum(
      item.category,
      OfferAnalysisConstants.REQUIREMENT_CATEGORY,
      "requirement category",
    );
    this.requireEnum(
      item.importance,
      OfferAnalysisConstants.REQUIREMENT_IMPORTANCE,
      "requirement importance",
    );
    this.validateSyntheticString(
      item.value,
      OfferAnalysisLimits.MAXIMUM_VALUE_LENGTH,
      "requirement value",
    );
    if (item.assertion !== OfferAnalysisConstants.ASSERTION.EXPLICIT) {
      throw new TypeError("Requirements must be explicit");
    }
    this.validateAssertionStructure(item.assertion, item.evidence, false);
  }

  /**
   * Validate one context item structure.
   * @param {unknown} item - Raw context item.
   * @returns {void}
   */
  validateContextStructure(item) {
    this.requireExactObject(item, CATEGORIZED_ITEM_KEYS, "context item");
    this.requireEnum(item.category, OfferAnalysisConstants.CONTEXT_CATEGORY, "context category");
    this.validateSyntheticString(
      item.value,
      OfferAnalysisLimits.MAXIMUM_VALUE_LENGTH,
      "context value",
    );
    this.validateAssertionStructure(item.assertion, item.evidence, true);
  }

  /**
   * Validate exact work-condition branches.
   * @param {unknown} workConditions - Raw work conditions.
   * @returns {void}
   */
  validateWorkConditionsStructure(workConditions) {
    this.requireExactObject(workConditions, WORK_CONDITIONS_KEYS, "workConditions");
    this.validateWorkModeStructure(workConditions.workMode);
    this.validateArray(
      workConditions.constraints,
      OfferAnalysisLimits.MAXIMUM_CONSTRAINTS,
      "constraints",
    );
    for (const item of workConditions.constraints) {
      this.validateConstraintStructure(item);
    }
  }

  /**
   * Validate one nullable explicit work mode.
   * @param {unknown} workMode - Raw work mode.
   * @returns {void}
   */
  validateWorkModeStructure(workMode) {
    if (workMode === null) {
      return;
    }
    this.requireExactObject(workMode, WORK_MODE_KEYS, "workMode");
    this.requireEnum(workMode.mode, OfferAnalysisConstants.WORK_MODE, "work mode");
    if (workMode.detail !== null) {
      this.validateSyntheticString(
        workMode.detail,
        OfferAnalysisLimits.MAXIMUM_DETAIL_LENGTH,
        "work mode detail",
      );
    }
    if (workMode.assertion !== OfferAnalysisConstants.ASSERTION.EXPLICIT) {
      throw new TypeError("Work mode must be explicit");
    }
    this.validateAssertionStructure(workMode.assertion, workMode.evidence, false);
  }

  /**
   * Validate one explicit work constraint.
   * @param {unknown} item - Raw constraint.
   * @returns {void}
   */
  validateConstraintStructure(item) {
    this.requireExactObject(item, CATEGORIZED_ITEM_KEYS, "constraint");
    this.requireEnum(
      item.category,
      OfferAnalysisConstants.CONSTRAINT_CATEGORY,
      "constraint category",
    );
    this.validateSyntheticString(
      item.value,
      OfferAnalysisLimits.MAXIMUM_VALUE_LENGTH,
      "constraint value",
    );
    if (item.assertion !== OfferAnalysisConstants.ASSERTION.EXPLICIT) {
      throw new TypeError("Constraints must be explicit");
    }
    this.validateAssertionStructure(item.assertion, item.evidence, false);
  }

  /**
   * Validate assertion and evidence shape without consulting source text yet.
   * @param {unknown} assertion - Assertion kind.
   * @param {unknown} evidence - Evidence candidate.
   * @param {boolean} allowInferred - Whether inferred assertion is allowed.
   * @returns {void}
   */
  validateAssertionStructure(assertion, evidence, allowInferred) {
    this.requireEnum(assertion, OfferAnalysisConstants.ASSERTION, "assertion");
    if (!allowInferred && assertion === OfferAnalysisConstants.ASSERTION.INFERRED) {
      throw new TypeError("Inferred assertion is not allowed here");
    }
    if (assertion === OfferAnalysisConstants.ASSERTION.INFERRED) {
      if (evidence !== null) {
        throw new TypeError("Inferred assertion evidence must be null");
      }
      return;
    }
    this.requireExactObject(evidence, EVIDENCE_KEYS, "evidence");
    if (typeof evidence.text !== "string" || !evidence.text.trim()) {
      throw new TypeError("Explicit assertion evidence is required");
    }
    if (evidence.text.length > OfferAnalysisLimits.MAXIMUM_EVIDENCE_LENGTH) {
      throw new TypeError("Evidence text is too long");
    }
  }

  /**
   * Enforce evidence exactness, non-empty output and final string invariants.
   * @param {object} analysis - Normalized analysis.
   * @param {string} effectiveText - Exact authoritative source text.
   * @returns {void}
   */
  validateFinalInvariants(analysis, effectiveText) {
    const semanticItems = this.collectSemanticItems(analysis);
    if (semanticItems.length === 0) {
      throw new TypeError("OfferAnalysis must contain semantic information");
    }
    for (const item of semanticItems) {
      if (Object.hasOwn(item, "value")) {
        this.validateNormalizedSyntheticString(item.value, "semantic value");
      }
      if (Object.hasOwn(item, "detail") && item.detail !== null) {
        this.validateNormalizedSyntheticString(item.detail, "work mode detail");
      }
      if (item.assertion === OfferAnalysisConstants.ASSERTION.EXPLICIT) {
        if (!effectiveText.includes(item.evidence.text)) {
          throw new TypeError("Explicit evidence was not found in effective text");
        }
      } else if (item.evidence !== null) {
        throw new TypeError("Inferred assertion evidence must be null");
      }
    }
  }

  /**
   * Collect every semantic object counted by the V1 global limit.
   * @param {object} analysis - Analysis candidate.
   * @returns {object[]} Flat semantic object list.
   */
  collectSemanticItems(analysis) {
    const items = [
      ...analysis.activities,
      ...analysis.requirements,
      ...analysis.context,
      ...analysis.workConditions.constraints,
    ];
    if (analysis.seniority !== null) {
      items.push(analysis.seniority);
    }
    if (analysis.workConditions.workMode !== null) {
      items.push(analysis.workConditions.workMode);
    }
    return items;
  }

  /**
   * Enforce the aggregate semantic item limit.
   * @param {object} analysis - Structurally valid analysis.
   * @returns {void}
   */
  validateTotal(analysis) {
    if (this.collectSemanticItems(analysis).length > OfferAnalysisLimits.MAXIMUM_SEMANTIC_ITEMS) {
      throw new TypeError("OfferAnalysis contains too many semantic items");
    }
  }

  /**
   * Require one exact plain-object key set.
   * @param {unknown} value - Object candidate.
   * @param {string[]} expectedKeys - Exact required whitelist.
   * @param {string} label - Diagnostic label.
   * @returns {void}
   */
  requireExactObject(value, expectedKeys, label) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError(`${label} must be an object`);
    }
    const actualKeys = Object.keys(value).sort();
    const requiredKeys = [...expectedKeys].sort();
    if (JSON.stringify(actualKeys) !== JSON.stringify(requiredKeys)) {
      throw new TypeError(`${label} contains missing or unknown properties`);
    }
  }

  /**
   * Require an array within one cardinality limit.
   * @param {unknown} value - Array candidate.
   * @param {number} maximum - Inclusive maximum length.
   * @param {string} label - Diagnostic label.
   * @returns {void}
   */
  validateArray(value, maximum, label) {
    if (!Array.isArray(value)) {
      throw new TypeError(`${label} must be an array`);
    }
    if (value.length > maximum) {
      throw new TypeError(`${label} contains too many items`);
    }
  }

  /**
   * Require a string that can be predictably normalized within its limit.
   * @param {unknown} value - String candidate.
   * @param {number} maximum - Inclusive String.length limit.
   * @param {string} label - Diagnostic label.
   * @returns {void}
   */
  validateSyntheticString(value, maximum, label) {
    if (typeof value !== "string") {
      throw new TypeError(`${label} must be a string`);
    }
    if (value.length > maximum) {
      throw new TypeError(`${label} is too long`);
    }
  }

  /**
   * Require a non-empty normalized synthetic string.
   * @param {string} value - Normalized string.
   * @param {string} label - Diagnostic label.
   * @returns {void}
   */
  validateNormalizedSyntheticString(value, label) {
    if (!value || value.length > OfferAnalysisLimits.MAXIMUM_VALUE_LENGTH) {
      throw new TypeError(`${label} is invalid after normalization`);
    }
  }

  /**
   * Require exact membership in one frozen enum object.
   * @param {unknown} value - Enum candidate.
   * @param {object} enumObject - Supported enum values.
   * @param {string} label - Diagnostic label.
   * @returns {void}
   */
  requireEnum(value, enumObject, label) {
    if (!Object.values(enumObject).includes(value)) {
      throw new TypeError(`Unsupported ${label}: ${value}`);
    }
  }
}

export { OfferAnalysisValidator };
