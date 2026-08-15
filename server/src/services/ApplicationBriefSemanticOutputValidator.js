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
    this.requireExactObject(candidate, ROOT_KEYS);
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
      this.fail();
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
    this.requireArray(matches, ApplicationBriefLimits.MAX_REQUIREMENT_MATCHES);
    const indices = new Set();
    for (const match of matches) {
      this.requireExactObject(match, REQUIREMENT_MATCH_KEYS);
      this.validateOfferRef(match.offerRef, ApplicationBriefConstants.OFFER_REF_KIND.REQUIREMENT);
      if (indices.has(match.offerRef.index)) {
        this.fail();
      }
      indices.add(match.offerRef.index);
      this.requireEnum(match.state, ApplicationBriefConstants.EVIDENCE_STATE);
      this.validateSupportedFacets(match.supportedFacets);
      this.validateNotEvidencedFacets(match.notEvidencedFacets);
      this.validateMatchInvariants(match);
    }
  }

  /**
   * Validate supported facets and their evidence references.
   * @param {unknown} facets - Supported facet candidates.
   * @returns {void}
   */
  validateSupportedFacets(facets) {
    this.requireArray(facets, ApplicationBriefLimits.MAX_FACETS_PER_REQUIREMENT_MATCH);
    const texts = new Set();
    for (const facet of facets) {
      this.requireExactObject(facet, SUPPORTED_FACET_KEYS);
      this.requireText(facet.text, OfferAnalysisLimits.MAXIMUM_VALUE_LENGTH);
      if (texts.has(facet.text)) {
        this.fail();
      }
      texts.add(facet.text);
      this.validateEvidenceRefs(facet.evidenceRefs, true);
    }
  }

  /**
   * Validate not-evidenced facets without candidate assertions.
   * @param {unknown} facets - Not-evidenced facet candidates.
   * @returns {void}
   */
  validateNotEvidencedFacets(facets) {
    this.requireArray(facets, ApplicationBriefLimits.MAX_FACETS_PER_REQUIREMENT_MATCH);
    const texts = new Set();
    for (const facet of facets) {
      this.requireExactObject(facet, NOT_EVIDENCED_FACET_KEYS);
      this.requireText(facet.text, OfferAnalysisLimits.MAXIMUM_VALUE_LENGTH);
      if (texts.has(facet.text)) {
        this.fail();
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
      this.fail();
    }
    if (match.supportedFacets.some((supported) => {
      return match.notEvidencedFacets.some((missing) => {
        return missing.text === supported.text;
      });
    })) {
      this.fail();
    }
    const states = ApplicationBriefConstants.EVIDENCE_STATE;
    const valid = (match.state === states.SUPPORTED && supportedCount > 0 && missingCount === 0)
      || (match.state === states.PARTIALLY_SUPPORTED && supportedCount > 0 && missingCount > 0)
      || (match.state === states.NOT_EVIDENCED && supportedCount === 0 && missingCount > 0);
    if (!valid) {
      this.fail();
    }
    const references = new Set();
    for (const facet of match.supportedFacets) {
      for (const reference of facet.evidenceRefs) {
        references.add(this.evidenceRefKey(reference));
      }
    }
    if (references.size > ApplicationBriefLimits.MAX_EVIDENCE_REFS_PER_ITEM) {
      this.fail();
    }
  }

  /**
   * Validate emphasis entries with non-authoritative bounded reasons.
   * @param {unknown} entries - Emphasis candidates.
   * @returns {void}
   */
  validateEmphasis(entries) {
    this.requireArray(entries, ApplicationBriefLimits.MAX_EMPHASIS);
    for (const entry of entries) {
      this.requireExactObject(entry, EMPHASIS_KEYS);
      this.requireEnum(entry.priority, ApplicationBriefConstants.PRIORITY);
      this.validateOfferRefs(entry.offerRefs, true);
      this.validateEvidenceRefs(entry.evidenceRefs, true);
      this.requireText(entry.relevanceReason, ApplicationBriefLimits.MAX_RELEVANCE_REASON_LENGTH);
    }
  }

  /**
   * Validate structured claims and proof-kind compatibility.
   * @param {unknown} claims - Supported claim candidates.
   * @returns {void}
   */
  validateSupportedClaims(claims) {
    this.requireArray(claims, ApplicationBriefLimits.MAX_SUPPORTED_CLAIMS);
    const signatures = new Set();
    for (const claim of claims) {
      this.requireExactObject(claim, SUPPORTED_CLAIM_KEYS);
      this.requireEnum(claim.claimType, ApplicationBriefConstants.CLAIM_TYPE);
      this.validateOfferRefs(claim.offerRefs, true);
      this.validateEvidenceRefs(claim.evidenceRefs, true);
      if (claim.evidenceRefs.some((reference) => {
        return reference.kind !== CLAIM_EVIDENCE_KIND[claim.claimType];
      })) {
        this.fail();
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
    this.requireArray(cautions, ApplicationBriefLimits.MAX_CAUTIONS);
    const signatures = new Set();
    for (const caution of cautions) {
      this.requireExactObject(caution, CAUTION_KEYS);
      this.requireEnum(caution.kind, ApplicationBriefConstants.CAUTION_KIND);
      this.validateOfferRefs(caution.offerRefs, true);
      this.validateEvidenceRefs(caution.evidenceRefs, true);
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
      this.requireExactObject(reference, SENIORITY_OFFER_REF_KEYS);
    } else {
      this.requireExactObject(reference, INDEXED_OFFER_REF_KEYS);
      this.requireEnum(reference.kind, ApplicationBriefConstants.OFFER_REF_KIND);
      if (!Number.isSafeInteger(reference.index) || reference.index < 0) {
        this.fail();
      }
    }
    if (requiredKind !== undefined && reference.kind !== requiredKind) {
      this.fail();
    }
  }

  /**
   * Validate bounded unique offer references.
   * @param {unknown} references - Offer reference candidates.
   * @param {boolean} nonEmpty - Whether the collection must be non-empty.
   * @returns {void}
   */
  validateOfferRefs(references, nonEmpty) {
    this.requireArray(references, ApplicationBriefLimits.MAX_REFS_PER_ITEM);
    if (nonEmpty && references.length === 0) {
      this.fail();
    }
    const keys = new Set();
    for (const reference of references) {
      this.validateOfferRef(reference);
      const key = reference.kind === ApplicationBriefConstants.OFFER_REF_KIND.SENIORITY
        ? reference.kind : `${reference.kind}:${reference.index}`;
      if (keys.has(key)) {
        this.fail();
      }
      keys.add(key);
    }
  }

  /**
   * Validate bounded unique evidence references.
   * @param {unknown} references - Evidence reference candidates.
   * @param {boolean} nonEmpty - Whether the collection must be non-empty.
   * @returns {void}
   */
  validateEvidenceRefs(references, nonEmpty) {
    this.requireArray(references, ApplicationBriefLimits.MAX_REFS_PER_ITEM);
    if (nonEmpty && references.length === 0) {
      this.fail();
    }
    const keys = new Set();
    for (const reference of references) {
      this.validateEvidenceRef(reference);
      const key = this.evidenceRefKey(reference);
      if (keys.has(key)) {
        this.fail();
      }
      keys.add(key);
    }
  }

  /**
   * Validate one evidence reference against the closed 9A.1 vocabulary.
   * @param {unknown} reference - Evidence reference candidate.
   * @returns {void}
   */
  validateEvidenceRef(reference) {
    this.requireExactObject(reference, EVIDENCE_REF_KEYS);
    this.requireEnum(reference.kind, ApplicationBriefConstants.EVIDENCE_KIND);
    if (typeof reference.itemId !== "string" || !reference.itemId
      || reference.itemId.length > CandidateDossierLimits.MAXIMUM_ID_LENGTH
      || !ID_PATTERN.test(reference.itemId)) {
      this.fail();
    }
    if (typeof reference.field !== "string") {
      this.fail();
    }
    const scalar = SCALAR_FIELDS[reference.kind]?.includes(reference.field);
    const indexedMatch = reference.field.match(ARRAY_FIELD_PATTERN);
    if (!scalar && !this.isValidIndexedField(reference.kind, indexedMatch)) {
      this.fail();
    }
  }

  /**
   * Validate an indexed evidence field against its kind and normative array bound.
   * @param {string} kind - Evidence kind.
   * @param {RegExpMatchArray|null} match - Parsed indexed field.
   * @returns {boolean} Whether the indexed field is valid.
   */
  isValidIndexedField(kind, match) {
    if (!match) {
      return false;
    }
    const allowed = {
      EXPERIENCE: ["activities", "achievements", "technologies"],
      PROJECT: ["activities", "achievements", "technologies"],
    };
    if (!allowed[kind]?.includes(match[1])) {
      return false;
    }
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
      this.fail();
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
   * @returns {void}
   */
  requireExactObject(value, expectedKeys) {
    if (value === null || typeof value !== "object" || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) {
      this.fail();
    }
    const keys = Object.keys(value);
    if (keys.length !== expectedKeys.length || keys.some((key) => {
      return !expectedKeys.includes(key);
    })) {
      this.fail();
    }
  }

  /**
   * Require one bounded array.
   * @param {unknown} value - Array candidate.
   * @param {number} maximum - Inclusive maximum length.
   * @returns {void}
   */
  requireArray(value, maximum) {
    if (!Array.isArray(value) || value.length > maximum) {
      this.fail();
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
      this.fail();
    }
  }

  /**
   * Require one non-empty bounded string without normalization.
   * @param {unknown} value - Text candidate.
   * @param {number} maximum - Maximum character length.
   * @returns {void}
   */
  requireText(value, maximum) {
    if (typeof value !== "string" || !value.trim() || value.length > maximum) {
      this.fail();
    }
  }

  /**
   * Raise the single closed semantic contract failure.
   * @returns {never}
   */
  fail() {
    throw new ApplicationBriefMatcherError(
      ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
      ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT,
    );
  }
}

export { ApplicationBriefSemanticOutputValidator };
