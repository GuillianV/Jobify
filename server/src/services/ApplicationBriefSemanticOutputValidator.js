import { ApplicationBriefConstants } from "../constants/ApplicationBriefConstants.js";
import { ApplicationBriefLimits } from "../constants/ApplicationBriefLimits.js";
import { CandidateDossierLimits } from "../constants/CandidateDossierLimits.js";
import { OfferAnalysisLimits } from "../constants/OfferAnalysisLimits.js";
import { ApplicationBriefMatcherError } from "./ApplicationBriefMatcherError.js";

const ROOT_KEYS = Object.freeze([
  "requirementMatches", "emphasis", "supportedClaims", "cautions",
]);
const INDEXED_OFFER_REF_KEYS = Object.freeze(["kind", "index"]);
const SENIORITY_OFFER_REF_KEYS = Object.freeze(["kind"]);
const EVIDENCE_REF_KEYS = Object.freeze(["kind", "itemId", "field"]);
const REQUIREMENT_MATCH_KEYS = Object.freeze([
  "offerRef", "state", "supportedFacets", "notEvidencedFacets",
]);
const SUPPORTED_FACET_KEYS = Object.freeze(["text", "evidenceRefs"]);
const NOT_EVIDENCED_FACET_KEYS = Object.freeze(["text"]);
const EMPHASIS_KEYS = Object.freeze([
  "priority", "offerRefs", "evidenceRefs", "relevanceReason",
]);
const SUPPORTED_CLAIM_KEYS = Object.freeze(["claimType", "offerRefs", "evidenceRefs"]);
const CAUTION_KEYS = Object.freeze(["kind", "offerRefs", "evidenceRefs"]);
const ID_PATTERN = /^[A-Za-z0-9_-]+$/u;
const ARRAY_FIELD_PATTERN = /^(activities|achievements|technologies)\[(0|[1-9]\d*)\]$/u;
const INDEXED_FIELD_PREFIX_PATTERN = /^(activities|achievements|technologies)\[/u;
const SCALAR_FIELDS = Object.freeze({
  EXPERIENCE: Object.freeze([
    "role", "organization", "client", "startDate", "endDate", "current", "domain",
  ]),
  PROJECT: Object.freeze(["name", "role", "startDate", "endDate", "domain", "summary"]),
  SKILL: Object.freeze(["category", "value", "detail"]),
  EDUCATION: Object.freeze([
    "diploma", "level", "field", "institution", "startDate", "endDate",
  ]),
  LANGUAGE: Object.freeze([
    "language", "overall", "reading", "writing", "speaking", "listening",
  ]),
  SOFT_SKILL: Object.freeze(["value", "detail"]),
});
const CLAIM_EVIDENCE_KIND = Object.freeze({
  EXPERIENCE_FACT: ApplicationBriefConstants.EVIDENCE_KIND.EXPERIENCE,
  PROJECT_FACT: ApplicationBriefConstants.EVIDENCE_KIND.PROJECT,
  SKILL_DECLARATION: ApplicationBriefConstants.EVIDENCE_KIND.SKILL,
  EDUCATION_FACT: ApplicationBriefConstants.EVIDENCE_KIND.EDUCATION,
  LANGUAGE_DECLARATION: ApplicationBriefConstants.EVIDENCE_KIND.LANGUAGE,
  SOFT_SKILL_DECLARATION: ApplicationBriefConstants.EVIDENCE_KIND.SOFT_SKILL,
});
const SUBCODE = ApplicationBriefMatcherError.SEMANTIC_VALIDATION_SUBCODE;
const CARDINALITY_RULE = ApplicationBriefMatcherError.CARDINALITY_RULE;
const NESTED_SHAPE_RULE = ApplicationBriefMatcherError.NESTED_SHAPE_RULE;

/**
 * Validates the strict semantic-only output accepted from the future matcher.
 */
class ApplicationBriefSemanticOutputValidator {
  /**
   * Validate semantic output without mutation, repair, sorting or contextual resolution.
   * @param {unknown} candidate - Untrusted semantic output candidate.
   * @returns {object} Detached validated semantic output preserving caller order.
   */
  validate(candidate) {
    this.requireExactObject(candidate, ROOT_KEYS, SUBCODE.ROOT_SHAPE_OR_KEYS);
    this.validateRequirementMatches(candidate.requirementMatches);
    this.validateEmphasis(candidate.emphasis);
    this.validateSupportedClaims(candidate.supportedClaims);
    this.validateCautions(candidate.cautions);
    this.validateGlobalEvidenceLimit(candidate);
    return structuredClone(candidate);
  }

  /**
   * Bound the global unique evidence union that deterministic assembly will materialize.
   * @param {object} semantic - Structurally validated semantic output.
   * @returns {void}
   */
  validateGlobalEvidenceLimit(semantic) {
    const references = new Set();
    for (const match of semantic.requirementMatches) {
      for (const facet of match.supportedFacets) {
        this.addEvidenceRefKeys(references, facet.evidenceRefs);
      }
    }
    for (const item of semantic.emphasis) {
      this.addEvidenceRefKeys(references, item.evidenceRefs);
    }
    for (const item of semantic.supportedClaims) {
      this.addEvidenceRefKeys(references, item.evidenceRefs);
    }
    for (const item of semantic.cautions) {
      this.addEvidenceRefKeys(references, item.evidenceRefs);
    }
    if (references.size > ApplicationBriefLimits.MAX_EVIDENCE_FACTS) {
      this.fail(SUBCODE.EVIDENCE_GLOBAL_LIMIT);
    }
  }

  /**
   * Add exact evidence identities to one union without normalization.
   * @param {Set<string>} destination - Evidence identity union.
   * @param {object[]} references - Validated evidence refs.
   * @returns {void}
   */
  addEvidenceRefKeys(destination, references) {
    for (const reference of references) {
      destination.add(this.evidenceRefKey(reference));
    }
  }

  /**
   * Validate requirement matches and their state/facet invariants.
   * @param {unknown} matches - Requirement match candidates.
   * @returns {void}
   */
  validateRequirementMatches(matches) {
    this.requireArray(
      matches,
      ApplicationBriefLimits.MAX_REQUIREMENT_MATCHES,
      CARDINALITY_RULE.ROOT_REQUIREMENT_MATCHES_MAX,
    );
    const indices = new Set();
    for (const [matchIndex, match] of matches.entries()) {
      this.requireExactObject(
        match,
        REQUIREMENT_MATCH_KEYS,
        SUBCODE.NESTED_SHAPE_OR_KEYS,
        NESTED_SHAPE_RULE.REQUIREMENT_MATCH_SHAPE,
      );
      this.validateOfferRef(match.offerRef, ApplicationBriefConstants.OFFER_REF_KIND.REQUIREMENT);
      if (indices.has(match.offerRef.index)) {
        this.fail(SUBCODE.DUPLICATE);
      }
      indices.add(match.offerRef.index);
      this.requireEnum(match.state, ApplicationBriefConstants.EVIDENCE_STATE);
      this.validateSupportedFacets(match.supportedFacets, matchIndex);
      this.validateNotEvidencedFacets(match.notEvidencedFacets, matchIndex);
      this.validateMatchInvariants(match);
    }
  }

  /**
   * Validate supported facets and their evidence references.
   * @param {unknown} facets - Supported facet candidates.
   * @param {number} matchIndex - Traversal-controlled requirement match index.
   * @returns {void}
   */
  validateSupportedFacets(facets, matchIndex) {
    this.requireArray(
      facets,
      ApplicationBriefLimits.MAX_FACETS_PER_REQUIREMENT_MATCH,
      CARDINALITY_RULE.REQUIREMENT_SUPPORTED_FACETS_MAX,
    );
    const texts = new Set();
    for (const [facetIndex, facet] of facets.entries()) {
      this.requireExactObject(
        facet,
        SUPPORTED_FACET_KEYS,
        SUBCODE.NESTED_SHAPE_OR_KEYS,
        NESTED_SHAPE_RULE.SUPPORTED_FACET_SHAPE,
      );
      const path = `requirementMatches[${matchIndex}].supportedFacets[${facetIndex}]`;
      this.requireText(
        facet.text,
        OfferAnalysisLimits.MAXIMUM_VALUE_LENGTH,
        `${path}.text`,
      );
      if (texts.has(facet.text)) {
        this.fail(SUBCODE.DUPLICATE);
      }
      texts.add(facet.text);
      this.validateEvidenceRefs(
        facet.evidenceRefs,
        true,
        `${path}.evidenceRefs`,
        CARDINALITY_RULE.SUPPORTED_FACET_EVIDENCE_REFS_MAX,
        CARDINALITY_RULE.SUPPORTED_FACET_EVIDENCE_REFS_MIN_ONE,
      );
    }
  }

  /**
   * Validate not-evidenced facets without candidate assertions.
   * @param {unknown} facets - Not-evidenced facet candidates.
   * @param {number} matchIndex - Traversal-controlled requirement match index.
   * @returns {void}
   */
  validateNotEvidencedFacets(facets, matchIndex) {
    this.requireArray(
      facets,
      ApplicationBriefLimits.MAX_FACETS_PER_REQUIREMENT_MATCH,
      CARDINALITY_RULE.REQUIREMENT_NOT_EVIDENCED_FACETS_MAX,
    );
    const texts = new Set();
    for (const [facetIndex, facet] of facets.entries()) {
      this.requireExactObject(
        facet,
        NOT_EVIDENCED_FACET_KEYS,
        SUBCODE.NESTED_SHAPE_OR_KEYS,
        NESTED_SHAPE_RULE.NOT_EVIDENCED_FACET_SHAPE,
      );
      this.requireText(
        facet.text,
        OfferAnalysisLimits.MAXIMUM_VALUE_LENGTH,
        `requirementMatches[${matchIndex}].notEvidencedFacets[${facetIndex}].text`,
      );
      if (texts.has(facet.text)) {
        this.fail(SUBCODE.DUPLICATE);
      }
      texts.add(facet.text);
    }
  }

  /**
   * Enforce match state cardinality, overlap and unique evidence limits.
   * @param {object} match - Structurally shaped match.
   * @returns {void}
   */
  validateMatchInvariants(match) {
    const supportedCount = match.supportedFacets.length;
    const missingCount = match.notEvidencedFacets.length;
    if (supportedCount + missingCount > ApplicationBriefLimits.MAX_FACETS_PER_REQUIREMENT_MATCH) {
      this.fail(
        SUBCODE.CARDINALITY,
        undefined,
        undefined,
        undefined,
        CARDINALITY_RULE.REQUIREMENT_COMBINED_FACETS_MAX,
      );
    }
    if (match.supportedFacets.some((supported) => {
      return match.notEvidencedFacets.some((missing) => {
        return missing.text === supported.text;
      });
    })) {
      this.fail(SUBCODE.STATE_FACET_INVARIANT);
    }
    const states = ApplicationBriefConstants.EVIDENCE_STATE;
    const valid = (match.state === states.SUPPORTED && supportedCount > 0 && missingCount === 0)
      || (match.state === states.PARTIALLY_SUPPORTED && supportedCount > 0 && missingCount > 0)
      || (match.state === states.NOT_EVIDENCED && supportedCount === 0 && missingCount > 0);
    if (!valid) {
      this.fail(SUBCODE.STATE_FACET_INVARIANT);
    }
    const references = new Set();
    for (const facet of match.supportedFacets) {
      for (const reference of facet.evidenceRefs) {
        references.add(this.evidenceRefKey(reference));
      }
    }
    if (references.size > ApplicationBriefLimits.MAX_EVIDENCE_REFS_PER_ITEM) {
      this.fail(
        SUBCODE.CARDINALITY,
        undefined,
        undefined,
        undefined,
        CARDINALITY_RULE.REQUIREMENT_UNIQUE_SUPPORTED_EVIDENCE_REFS_MAX,
      );
    }
  }

  /**
   * Validate emphasis entries with non-authoritative bounded reasons.
   * @param {unknown} entries - Emphasis candidates.
   * @returns {void}
   */
  validateEmphasis(entries) {
    this.requireArray(
      entries,
      ApplicationBriefLimits.MAX_EMPHASIS,
      CARDINALITY_RULE.ROOT_EMPHASIS_MAX,
    );
    for (const [entryIndex, entry] of entries.entries()) {
      const path = `emphasis[${entryIndex}]`;
      this.requireExactObject(
        entry,
        EMPHASIS_KEYS,
        SUBCODE.NESTED_SHAPE_OR_KEYS,
        NESTED_SHAPE_RULE.EMPHASIS_SHAPE,
      );
      this.requireEnum(entry.priority, ApplicationBriefConstants.PRIORITY);
      this.validateOfferRefs(
        entry.offerRefs,
        true,
        CARDINALITY_RULE.EMPHASIS_OFFER_REFS_MAX,
        CARDINALITY_RULE.EMPHASIS_OFFER_REFS_MIN_ONE,
      );
      this.validateEvidenceRefs(
        entry.evidenceRefs,
        true,
        `${path}.evidenceRefs`,
        CARDINALITY_RULE.EMPHASIS_EVIDENCE_REFS_MAX,
        CARDINALITY_RULE.EMPHASIS_EVIDENCE_REFS_MIN_ONE,
      );
      this.requireText(
        entry.relevanceReason,
        ApplicationBriefLimits.MAX_RELEVANCE_REASON_LENGTH,
        `${path}.relevanceReason`,
      );
    }
  }

  /**
   * Validate structured claims and proof-kind compatibility.
   * @param {unknown} claims - Supported claim candidates.
   * @returns {void}
   */
  validateSupportedClaims(claims) {
    this.requireArray(
      claims,
      ApplicationBriefLimits.MAX_SUPPORTED_CLAIMS,
      CARDINALITY_RULE.ROOT_SUPPORTED_CLAIMS_MAX,
    );
    const signatures = new Set();
    for (const [claimIndex, claim] of claims.entries()) {
      this.requireExactObject(
        claim,
        SUPPORTED_CLAIM_KEYS,
        SUBCODE.NESTED_SHAPE_OR_KEYS,
        NESTED_SHAPE_RULE.SUPPORTED_CLAIM_SHAPE,
      );
      this.requireEnum(claim.claimType, ApplicationBriefConstants.CLAIM_TYPE);
      this.validateOfferRefs(
        claim.offerRefs,
        true,
        CARDINALITY_RULE.SUPPORTED_CLAIM_OFFER_REFS_MAX,
        CARDINALITY_RULE.SUPPORTED_CLAIM_OFFER_REFS_MIN_ONE,
      );
      this.validateEvidenceRefs(
        claim.evidenceRefs,
        true,
        `supportedClaims[${claimIndex}].evidenceRefs`,
        CARDINALITY_RULE.SUPPORTED_CLAIM_EVIDENCE_REFS_MAX,
        CARDINALITY_RULE.SUPPORTED_CLAIM_EVIDENCE_REFS_MIN_ONE,
      );
      if (claim.evidenceRefs.some((reference) => {
        return reference.kind !== CLAIM_EVIDENCE_KIND[claim.claimType];
      })) {
        this.fail(SUBCODE.CLAIM_EVIDENCE_KIND_MISMATCH);
      }
      this.rejectDuplicateSignature(signatures, claim);
    }
  }

  /**
   * Validate closed overclaim cautions.
   * @param {unknown} cautions - Caution candidates.
   * @returns {void}
   */
  validateCautions(cautions) {
    this.requireArray(
      cautions,
      ApplicationBriefLimits.MAX_CAUTIONS,
      CARDINALITY_RULE.ROOT_CAUTIONS_MAX,
    );
    const signatures = new Set();
    for (const [cautionIndex, caution] of cautions.entries()) {
      this.requireExactObject(
        caution,
        CAUTION_KEYS,
        SUBCODE.NESTED_SHAPE_OR_KEYS,
        NESTED_SHAPE_RULE.CAUTION_SHAPE,
      );
      this.requireEnum(caution.kind, ApplicationBriefConstants.CAUTION_KIND);
      this.validateOfferRefs(
        caution.offerRefs,
        true,
        CARDINALITY_RULE.CAUTION_OFFER_REFS_MAX,
        CARDINALITY_RULE.CAUTION_OFFER_REFS_MIN_ONE,
      );
      this.validateEvidenceRefs(
        caution.evidenceRefs,
        true,
        `cautions[${cautionIndex}].evidenceRefs`,
        CARDINALITY_RULE.CAUTION_EVIDENCE_REFS_MAX,
        CARDINALITY_RULE.CAUTION_EVIDENCE_REFS_MIN_ONE,
      );
      this.rejectDuplicateSignature(signatures, caution);
    }
  }

  /**
   * Validate one offer reference with an optional required kind.
   * @param {unknown} reference - Offer reference candidate.
   * @param {string} [requiredKind] - Required offer kind.
   * @returns {void}
   */
  validateOfferRef(reference, requiredKind) {
    if (reference !== null && typeof reference === "object" && !Array.isArray(reference)
      && reference.kind === ApplicationBriefConstants.OFFER_REF_KIND.SENIORITY) {
      this.requireExactObject(
        reference,
        SENIORITY_OFFER_REF_KEYS,
        SUBCODE.NESTED_SHAPE_OR_KEYS,
        NESTED_SHAPE_RULE.OFFER_REF_SENIORITY_SHAPE,
      );
    } else {
      this.requireExactObject(
        reference,
        INDEXED_OFFER_REF_KEYS,
        SUBCODE.NESTED_SHAPE_OR_KEYS,
        NESTED_SHAPE_RULE.OFFER_REF_INDEXED_SHAPE,
      );
      this.requireEnum(reference.kind, ApplicationBriefConstants.OFFER_REF_KIND);
      if (!Number.isSafeInteger(reference.index) || reference.index < 0) {
        this.fail(SUBCODE.TYPE);
      }
    }
    if (requiredKind !== undefined && reference.kind !== requiredKind) {
      this.fail(SUBCODE.TYPE);
    }
  }

  /**
   * Validate bounded unique offer references.
   * @param {unknown} references - Offer reference candidates.
   * @param {boolean} nonEmpty - Whether the collection must be non-empty.
   * @param {string} maximumRule - Closed maximum cardinality rule.
   * @param {string} minimumRule - Closed non-empty cardinality rule.
   * @returns {void}
   */
  validateOfferRefs(references, nonEmpty, maximumRule, minimumRule) {
    this.requireArray(references, ApplicationBriefLimits.MAX_REFS_PER_ITEM, maximumRule);
    if (nonEmpty && references.length === 0) {
      this.fail(SUBCODE.CARDINALITY, undefined, undefined, undefined, minimumRule);
    }
    const keys = new Set();
    for (const reference of references) {
      this.validateOfferRef(reference);
      const key = reference.kind === ApplicationBriefConstants.OFFER_REF_KIND.SENIORITY
        ? reference.kind : `${reference.kind}:${reference.index}`;
      if (keys.has(key)) {
        this.fail(SUBCODE.DUPLICATE);
      }
      keys.add(key);
    }
  }

  /**
   * Validate bounded unique evidence references.
   * @param {unknown} references - Evidence reference candidates.
   * @param {boolean} nonEmpty - Whether the collection must be non-empty.
   * @param {string} path - Closed structural collection path.
   * @param {string} maximumRule - Closed maximum cardinality rule.
   * @param {string} minimumRule - Closed non-empty cardinality rule.
   * @returns {void}
   */
  validateEvidenceRefs(references, nonEmpty, path, maximumRule, minimumRule) {
    this.requireArray(references, ApplicationBriefLimits.MAX_REFS_PER_ITEM, maximumRule);
    if (nonEmpty && references.length === 0) {
      this.fail(SUBCODE.CARDINALITY, undefined, undefined, undefined, minimumRule);
    }
    const keys = new Set();
    for (const [referenceIndex, reference] of references.entries()) {
      this.validateEvidenceRef(reference, `${path}[${referenceIndex}]`);
      const key = this.evidenceRefKey(reference);
      if (keys.has(key)) {
        this.fail(SUBCODE.DUPLICATE);
      }
      keys.add(key);
    }
  }

  /**
   * Validate one evidence reference against the closed 9A.1 vocabulary.
   * @param {unknown} reference - Evidence reference candidate.
   * @param {string} path - Closed structural evidence reference path.
   * @returns {void}
   */
  validateEvidenceRef(reference, path) {
    this.requireExactObject(
      reference,
      EVIDENCE_REF_KEYS,
      SUBCODE.NESTED_SHAPE_OR_KEYS,
      NESTED_SHAPE_RULE.EVIDENCE_REF_SHAPE,
    );
    this.requireEnum(reference.kind, ApplicationBriefConstants.EVIDENCE_KIND);
    const categories = ApplicationBriefMatcherError.VALIDATION_CATEGORY;
    const rules = ApplicationBriefMatcherError.VALIDATION_RULE;
    if (typeof reference.itemId !== "string") {
      this.failFormat(`${path}.itemId`, categories.IDENTIFIER_ITEM_ID, rules.ITEM_ID_NOT_STRING);
    }
    if (!reference.itemId) {
      this.failFormat(`${path}.itemId`, categories.IDENTIFIER_ITEM_ID, rules.ITEM_ID_EMPTY);
    }
    if (reference.itemId.length > CandidateDossierLimits.MAXIMUM_ID_LENGTH) {
      this.failFormat(`${path}.itemId`, categories.IDENTIFIER_ITEM_ID, rules.ITEM_ID_TOO_LONG);
    }
    if (!ID_PATTERN.test(reference.itemId)) {
      this.failFormat(
        `${path}.itemId`,
        categories.IDENTIFIER_ITEM_ID,
        rules.ITEM_ID_INVALID_CHARSET,
      );
    }
    if (typeof reference.field !== "string") {
      this.fail(
        SUBCODE.TYPE,
        `${path}.field`,
        categories.IDENTIFIER_FIELD,
        rules.FIELD_NOT_STRING,
      );
    }
    const scalar = SCALAR_FIELDS[reference.kind]?.includes(reference.field);
    const indexedMatch = reference.field.match(ARRAY_FIELD_PATTERN);
    if (scalar) {
      return;
    }
    if (indexedMatch === null) {
      const rule = INDEXED_FIELD_PREFIX_PATTERN.test(reference.field)
        ? rules.FIELD_INVALID_INDEXED_SYNTAX
        : rules.FIELD_UNKNOWN_SCALAR;
      this.failFormat(`${path}.field`, categories.IDENTIFIER_FIELD, rule);
    }
    if (!this.isIndexedFieldKindCompatible(reference.kind, indexedMatch)) {
      this.failFormat(
        `${path}.field`,
        categories.IDENTIFIER_FIELD,
        rules.FIELD_KIND_INCOMPATIBLE,
      );
    }
    if (!this.isIndexedFieldInNormativeRange(indexedMatch)) {
      this.failFormat(
        `${path}.field`,
        categories.IDENTIFIER_FIELD,
        rules.FIELD_INDEX_OUT_OF_NORMATIVE_RANGE,
      );
    }
  }

  /**
   * Validate an indexed evidence field against its evidence kind.
   * @param {string} kind - Evidence kind.
   * @param {RegExpMatchArray} match - Parsed indexed field.
   * @returns {boolean} Whether the indexed field is legal for the kind.
   */
  isIndexedFieldKindCompatible(kind, match) {
    const allowed = {
      EXPERIENCE: ["activities", "achievements", "technologies"],
      PROJECT: ["activities", "achievements", "technologies"],
    };
    return allowed[kind]?.includes(match[1]) === true;
  }

  /**
   * Validate an indexed evidence field against its normative array bound.
   * @param {RegExpMatchArray} match - Parsed indexed field.
   * @returns {boolean} Whether the index is within its normative maximum.
   */
  isIndexedFieldInNormativeRange(match) {
    const limits = {
      activities: CandidateDossierLimits.MAXIMUM_ACTIVITIES,
      achievements: CandidateDossierLimits.MAXIMUM_ACHIEVEMENTS,
      technologies: CandidateDossierLimits.MAXIMUM_TECHNOLOGIES,
    };
    const index = Number(match[2]);
    return Number.isSafeInteger(index) && index < limits[match[1]];
  }

  /**
   * Reject duplicate canonical object signatures without normalization.
   * @param {Set<string>} signatures - Existing signatures.
   * @param {object} value - Structured item.
   * @returns {void}
   */
  rejectDuplicateSignature(signatures, value) {
    const signature = this.canonicalize(value);
    if (signatures.has(signature)) {
      this.fail(SUBCODE.DUPLICATE);
    }
    signatures.add(signature);
  }

  /**
   * Canonically serialize a JSON-compatible value for structural duplicate checks.
   * @param {unknown} value - Value to serialize.
   * @returns {string} Canonical JSON signature.
   */
  canonicalize(value) {
    if (Array.isArray(value)) {
      return `[${value.map((item) => {
        return this.canonicalize(item);
      }).join(",")}]`;
    }
    if (value !== null && typeof value === "object") {
      const pairs = Object.keys(value).sort().map((key) => {
        return `${JSON.stringify(key)}:${this.canonicalize(value[key])}`;
      });
      return `{${pairs.join(",")}}`;
    }
    return JSON.stringify(value);
  }

  /**
   * Build a stable exact evidence reference key.
   * @param {object} reference - Valid evidence reference.
   * @returns {string} Stable reference key.
   */
  evidenceRefKey(reference) {
    return `${reference.kind}:${reference.itemId}:${reference.field}`;
  }

  /**
   * Require one exact plain-object key set.
   * @param {unknown} value - Object candidate.
   * @param {string[]} expectedKeys - Exact required keys.
   * @param {string} [subcode] - Closed shape category.
   * @param {string} [nestedShapeRule] - Closed nested-shape predicate.
   * @returns {void}
   */
  requireExactObject(
    value,
    expectedKeys,
    subcode = SUBCODE.NESTED_SHAPE_OR_KEYS,
    nestedShapeRule,
  ) {
    if (value === null || typeof value !== "object" || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) {
      this.fail(subcode, undefined, undefined, undefined, undefined, nestedShapeRule);
    }
    const keys = Object.keys(value);
    if (keys.length !== expectedKeys.length || keys.some((key) => {
      return !expectedKeys.includes(key);
    })) {
      this.fail(subcode, undefined, undefined, undefined, undefined, nestedShapeRule);
    }
  }

  /**
   * Require one bounded array.
   * @param {unknown} value - Array candidate.
   * @param {number} maximum - Inclusive maximum length.
   * @param {string} cardinalityRule - Closed maximum cardinality rule.
   * @returns {void}
   */
  requireArray(value, maximum, cardinalityRule) {
    if (!Array.isArray(value)) {
      this.fail(SUBCODE.TYPE);
    }
    if (value.length > maximum) {
      this.fail(SUBCODE.CARDINALITY, undefined, undefined, undefined, cardinalityRule);
    }
  }

  /**
   * Require one exact closed enum value.
   * @param {unknown} value - Enum candidate.
   * @param {object} enumObject - Closed enum object.
   * @returns {void}
   */
  requireEnum(value, enumObject) {
    if (!Object.values(enumObject).includes(value)) {
      this.fail(SUBCODE.ENUM);
    }
  }

  /**
   * Require one non-empty bounded string without normalization.
   * @param {unknown} value - Text candidate.
   * @param {number} maximum - Maximum character length.
   * @returns {void}
   */
  requireText(value, maximum, path) {
    const category = ApplicationBriefMatcherError.VALIDATION_CATEGORY.TEXT;
    const rules = ApplicationBriefMatcherError.VALIDATION_RULE;
    if (typeof value !== "string") {
      this.failFormat(path, category, rules.TEXT_NOT_STRING);
    }
    if (!value.trim()) {
      this.failFormat(path, category, rules.TEXT_BLANK);
    }
    if (value.length > maximum) {
      this.failFormat(path, category, rules.TEXT_TOO_LONG);
    }
  }

  /**
   * Raise one safely localized text or identifier format failure.
   * @param {string} path - Closed structural output path.
   * @param {string} category - Closed field category.
   * @param {string} rule - Closed deterministic rule.
   * @returns {never}
   */
  failFormat(path, category, rule) {
    this.fail(SUBCODE.TEXT_OR_IDENTIFIER_FORMAT, path, category, rule);
  }

  /**
   * Raise the single closed semantic contract failure.
   * @param {string} subcode - Closed semantic validation category.
   * @param {string} [validationPath] - Closed structural output path.
   * @param {string} [validationCategory] - Closed field category.
   * @param {string} [validationRule] - Closed deterministic rule.
   * @param {string} [cardinalityRule] - Closed cardinality predicate.
   * @param {string} [nestedShapeRule] - Closed nested-shape predicate.
   * @returns {never}
   */
  fail(
    subcode,
    validationPath,
    validationCategory,
    validationRule,
    cardinalityRule,
    nestedShapeRule,
  ) {
    throw new ApplicationBriefMatcherError(
      ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
      ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT,
      null,
      {
        validationCode: ApplicationBriefMatcherError.VALIDATION_CODE.SEMANTIC_VALIDATION,
        validationSubcode: subcode,
        validationPath,
        validationCategory,
        validationRule,
        cardinalityRule,
        nestedShapeRule,
      },
    );
  }
}

export { ApplicationBriefSemanticOutputValidator };
