import { ApplicationBriefConstants } from "../constants/ApplicationBriefConstants.js";
import { ApplicationBriefLimits } from "../constants/ApplicationBriefLimits.js";
import { CandidateDossierConstants } from "../constants/CandidateDossierConstants.js";
import { CandidateDossierLimits } from "../constants/CandidateDossierLimits.js";
import { OfferAnalysisConstants } from "../constants/OfferAnalysisConstants.js";
import { OfferAnalysisLimits } from "../constants/OfferAnalysisLimits.js";
import { ApplicationBrief } from "../models/ApplicationBrief.js";
import { ApplicationBriefValidationError } from "./ApplicationBriefValidationError.js";

const ROOT_KEYS = Object.freeze([
  "schemaVersion", "inputIdentity", "requirementMatches", "evidenceFacts", "emphasis",
  "supportedClaims", "cautions",
]);
const INPUT_IDENTITY_KEYS = Object.freeze(["offer", "candidate"]);
const OFFER_IDENTITY_KEYS = Object.freeze([
  "offerId", "analysisFingerprint", "analysisSchemaVersion", "analyzerPolicyVersion",
]);
const CANDIDATE_IDENTITY_KEYS = Object.freeze(["fingerprint", "schemaVersion"]);
const INDEXED_OFFER_REF_KEYS = Object.freeze(["kind", "index"]);
const SENIORITY_OFFER_REF_KEYS = Object.freeze(["kind"]);
const EVIDENCE_REF_KEYS = Object.freeze(["kind", "itemId", "field"]);
const REQUIREMENT_MATCH_KEYS = Object.freeze([
  "offerRef", "state", "supportedFacets", "notEvidencedFacets",
]);
const SUPPORTED_FACET_KEYS = Object.freeze(["text", "evidenceRefs"]);
const NOT_EVIDENCED_FACET_KEYS = Object.freeze(["text"]);
const EVIDENCE_FACT_KEYS = Object.freeze(["ref", "value"]);
const EMPHASIS_KEYS = Object.freeze([
  "priority", "offerRefs", "evidenceRefs", "relevanceReason",
]);
const SUPPORTED_CLAIM_KEYS = Object.freeze(["claimType", "offerRefs", "evidenceRefs"]);
const CAUTION_KEYS = Object.freeze(["kind", "offerRefs", "evidenceRefs"]);
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
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
 * Validates and materializes the strict structural ApplicationBrief V1 contract.
 * Offer and candidate reference resolution remains intentionally deferred to 9A.2.
 */
class ApplicationBriefValidator {
  /**
   * Validate one complete brief without mutation or contextual resolution.
   * @param {unknown} candidate - Untrusted brief candidate.
   * @returns {ApplicationBrief} Immutable structurally validated brief.
   */
  validate(candidate) {
    this.requireExactObject(candidate, ROOT_KEYS, "application brief");
    if (candidate.schemaVersion !== ApplicationBriefConstants.SCHEMA_VERSION) {
      this.fail("ApplicationBrief schema version is invalid");
    }
    this.validateInputIdentity(candidate.inputIdentity);
    this.validateRequirementMatches(candidate.requirementMatches);
    this.validateEvidenceFacts(candidate.evidenceFacts);
    this.validateEmphasis(candidate.emphasis);
    this.validateSupportedClaims(candidate.supportedClaims);
    this.validateCautions(candidate.cautions);
    this.validateEvidenceFactIntegrity(candidate);
    return new ApplicationBrief(candidate);
  }

  /**
   * Validate immutable identities for the offer analysis and candidate content.
   * @param {unknown} identity - Input identity candidate.
   * @returns {void}
   */
  validateInputIdentity(identity) {
    this.requireExactObject(identity, INPUT_IDENTITY_KEYS, "input identity");
    this.requireExactObject(identity.offer, OFFER_IDENTITY_KEYS, "offer identity");
    this.requirePositiveInteger(identity.offer.offerId, "offer id");
    this.requireHash(identity.offer.analysisFingerprint, "analysis fingerprint");
    if (identity.offer.analysisSchemaVersion !== OfferAnalysisConstants.SCHEMA_VERSION) {
      this.fail("Offer analysis schema version is invalid");
    }
    this.requireText(
      identity.offer.analyzerPolicyVersion,
      ApplicationBriefLimits.MAX_ANALYZER_POLICY_VERSION_LENGTH,
      "analyzer policy version",
    );
    this.requireExactObject(identity.candidate, CANDIDATE_IDENTITY_KEYS, "candidate identity");
    this.requireHash(identity.candidate.fingerprint, "candidate fingerprint");
    if (identity.candidate.schemaVersion !== CandidateDossierConstants.SCHEMA_VERSION) {
      this.fail("Candidate dossier schema version is invalid");
    }
  }

  /**
   * Validate requirement matches, state invariants and match-wide limits.
   * @param {unknown} matches - Requirement match candidates.
   * @returns {void}
   */
  validateRequirementMatches(matches) {
    this.requireArray(matches, ApplicationBriefLimits.MAX_REQUIREMENT_MATCHES, "requirement matches");
    const indices = new Set();
    for (const match of matches) {
      this.requireExactObject(match, REQUIREMENT_MATCH_KEYS, "requirement match");
      this.validateOfferRef(match.offerRef, ApplicationBriefConstants.OFFER_REF_KIND.REQUIREMENT);
      if (indices.has(match.offerRef.index)) {
        this.fail("Requirement match index is duplicated");
      }
      indices.add(match.offerRef.index);
      this.requireEnum(match.state, ApplicationBriefConstants.EVIDENCE_STATE, "evidence state");
      this.validateSupportedFacets(match.supportedFacets);
      this.validateNotEvidencedFacets(match.notEvidencedFacets);
      this.validateMatchInvariants(match);
    }
  }

  /**
   * Validate supported facets with non-empty unique evidence references.
   * @param {unknown} facets - Supported facet candidates.
   * @returns {void}
   */
  validateSupportedFacets(facets) {
    this.requireArray(facets, ApplicationBriefLimits.MAX_FACETS_PER_REQUIREMENT_MATCH, "supported facets");
    const texts = new Set();
    for (const facet of facets) {
      this.requireExactObject(facet, SUPPORTED_FACET_KEYS, "supported facet");
      this.requireText(facet.text, OfferAnalysisLimits.MAXIMUM_VALUE_LENGTH, "supported facet text");
      if (texts.has(facet.text)) {
        this.fail("Supported facet text is duplicated");
      }
      texts.add(facet.text);
      this.validateEvidenceRefs(facet.evidenceRefs, true);
    }
  }

  /**
   * Validate not-evidenced facets as exact text fragments without candidate assertions.
   * @param {unknown} facets - Not-evidenced facet candidates.
   * @returns {void}
   */
  validateNotEvidencedFacets(facets) {
    this.requireArray(facets, ApplicationBriefLimits.MAX_FACETS_PER_REQUIREMENT_MATCH, "not-evidenced facets");
    const texts = new Set();
    for (const facet of facets) {
      this.requireExactObject(facet, NOT_EVIDENCED_FACET_KEYS, "not-evidenced facet");
      this.requireText(facet.text, OfferAnalysisLimits.MAXIMUM_VALUE_LENGTH, "not-evidenced facet text");
      if (texts.has(facet.text)) {
        this.fail("Not-evidenced facet text is duplicated");
      }
      texts.add(facet.text);
    }
  }

  /**
   * Enforce match state cardinalities and the unique match-wide evidence limit.
   * @param {object} match - Structurally valid requirement match.
   * @returns {void}
   */
  validateMatchInvariants(match) {
    const supportedCount = match.supportedFacets.length;
    const notEvidencedCount = match.notEvidencedFacets.length;
    if (supportedCount + notEvidencedCount > ApplicationBriefLimits.MAX_FACETS_PER_REQUIREMENT_MATCH) {
      this.fail("Requirement match contains too many facets");
    }
    const overlap = match.supportedFacets.some((supported) => {
      return match.notEvidencedFacets.some((missing) => {
        return missing.text === supported.text;
      });
    });
    if (overlap) {
      this.fail("Facet text cannot be both supported and not evidenced");
    }
    const state = ApplicationBriefConstants.EVIDENCE_STATE;
    const valid = (match.state === state.SUPPORTED && supportedCount > 0 && notEvidencedCount === 0)
      || (match.state === state.PARTIALLY_SUPPORTED && supportedCount > 0 && notEvidencedCount > 0)
      || (match.state === state.NOT_EVIDENCED && supportedCount === 0 && notEvidencedCount > 0);
    if (!valid) {
      this.fail("Requirement match state and facets are inconsistent");
    }
    const uniqueRefs = new Set();
    for (const facet of match.supportedFacets) {
      for (const reference of facet.evidenceRefs) {
        uniqueRefs.add(this.evidenceRefKey(reference));
      }
    }
    if (uniqueRefs.size > ApplicationBriefLimits.MAX_EVIDENCE_REFS_PER_ITEM) {
      this.fail("Requirement match contains too many unique evidence references");
    }
  }

  /**
   * Validate the exact selected candidate fact registry.
   * @param {unknown} facts - Evidence fact candidates.
   * @returns {void}
   */
  validateEvidenceFacts(facts) {
    this.requireArray(facts, ApplicationBriefLimits.MAX_EVIDENCE_FACTS, "evidence facts");
    const references = new Set();
    for (const fact of facts) {
      this.requireExactObject(fact, EVIDENCE_FACT_KEYS, "evidence fact");
      this.validateEvidenceRef(fact.ref);
      const key = this.evidenceRefKey(fact.ref);
      if (references.has(key)) {
        this.fail("Evidence fact reference is duplicated");
      }
      references.add(key);
      const expectedType = fact.ref.kind === ApplicationBriefConstants.EVIDENCE_KIND.EXPERIENCE
        && fact.ref.field === "current" ? "boolean" : "string";
      if (typeof fact.value !== expectedType || (expectedType === "string" && !fact.value)) {
        this.fail("Evidence fact value type is incompatible with its field");
      }
    }
  }

  /**
   * Validate emphasis entries independently from requirement match state.
   * @param {unknown} entries - Emphasis candidates.
   * @returns {void}
   */
  validateEmphasis(entries) {
    this.requireArray(entries, ApplicationBriefLimits.MAX_EMPHASIS, "emphasis");
    for (const entry of entries) {
      this.requireExactObject(entry, EMPHASIS_KEYS, "emphasis item");
      this.requireEnum(entry.priority, ApplicationBriefConstants.PRIORITY, "emphasis priority");
      this.validateOfferRefs(entry.offerRefs, true);
      this.validateEvidenceRefs(entry.evidenceRefs, true);
      this.requireText(
        entry.relevanceReason,
        ApplicationBriefLimits.MAX_RELEVANCE_REASON_LENGTH,
        "relevance reason",
      );
    }
  }

  /**
   * Validate structured supported claims and proof-kind compatibility.
   * @param {unknown} claims - Supported claim candidates.
   * @returns {void}
   */
  validateSupportedClaims(claims) {
    this.requireArray(claims, ApplicationBriefLimits.MAX_SUPPORTED_CLAIMS, "supported claims");
    const signatures = new Set();
    for (const claim of claims) {
      this.requireExactObject(claim, SUPPORTED_CLAIM_KEYS, "supported claim");
      this.requireEnum(claim.claimType, ApplicationBriefConstants.CLAIM_TYPE, "claim type");
      this.validateOfferRefs(claim.offerRefs, true);
      this.validateEvidenceRefs(claim.evidenceRefs, true);
      const expectedKind = CLAIM_EVIDENCE_KIND[claim.claimType];
      if (claim.evidenceRefs.some((reference) => {
        return reference.kind !== expectedKind;
      })) {
        this.fail("Supported claim evidence kind is incompatible with claim type");
      }
      this.rejectDuplicateSignature(signatures, claim, "Supported claim is duplicated");
    }
  }

  /**
   * Validate closed overclaim caution entries.
   * @param {unknown} cautions - Caution candidates.
   * @returns {void}
   */
  validateCautions(cautions) {
    this.requireArray(cautions, ApplicationBriefLimits.MAX_CAUTIONS, "cautions");
    const signatures = new Set();
    for (const caution of cautions) {
      this.requireExactObject(caution, CAUTION_KEYS, "caution");
      this.requireEnum(caution.kind, ApplicationBriefConstants.CAUTION_KIND, "caution kind");
      this.validateOfferRefs(caution.offerRefs, true);
      this.validateEvidenceRefs(caution.evidenceRefs, true);
      this.rejectDuplicateSignature(signatures, caution, "Caution is duplicated");
    }
  }

  /**
   * Require an exact one-to-one registry for all evidence references used by the brief.
   * @param {object} brief - Structurally validated brief candidate.
   * @returns {void}
   */
  validateEvidenceFactIntegrity(brief) {
    const used = new Set();
    for (const match of brief.requirementMatches) {
      for (const facet of match.supportedFacets) {
        this.addEvidenceRefKeys(used, facet.evidenceRefs);
      }
    }
    for (const entry of [...brief.emphasis, ...brief.supportedClaims, ...brief.cautions]) {
      this.addEvidenceRefKeys(used, entry.evidenceRefs);
    }
    const facts = new Set(brief.evidenceFacts.map((fact) => {
      return this.evidenceRefKey(fact.ref);
    }));
    if (used.size !== facts.size || [...used].some((key) => {
      return !facts.has(key);
    })) {
      this.fail("Evidence facts must correspond exactly to used evidence references");
    }
  }

  /**
   * Validate one offer reference with an optional required kind.
   * @param {unknown} reference - Offer reference candidate.
   * @param {string} [requiredKind] - Required offer reference kind.
   * @returns {void}
   */
  validateOfferRef(reference, requiredKind) {
    if (reference !== null && typeof reference === "object" && !Array.isArray(reference)
      && reference.kind === ApplicationBriefConstants.OFFER_REF_KIND.SENIORITY) {
      this.requireExactObject(reference, SENIORITY_OFFER_REF_KEYS, "seniority offer reference");
    } else {
      this.requireExactObject(reference, INDEXED_OFFER_REF_KEYS, "offer reference");
      this.requireEnum(reference.kind, ApplicationBriefConstants.OFFER_REF_KIND, "offer reference kind");
      this.requireNonNegativeInteger(reference.index, "offer reference index");
    }
    if (requiredKind !== undefined && reference.kind !== requiredKind) {
      this.fail("Offer reference kind is invalid in this context");
    }
  }

  /**
   * Validate a bounded non-empty or optional offer reference array without duplicates.
   * @param {unknown} references - Offer reference candidates.
   * @param {boolean} nonEmpty - Whether at least one reference is required.
   * @returns {void}
   */
  validateOfferRefs(references, nonEmpty) {
    this.requireArray(references, ApplicationBriefLimits.MAX_REFS_PER_ITEM, "offer references");
    if (nonEmpty && references.length === 0) {
      this.fail("Offer references must not be empty");
    }
    const keys = new Set();
    for (const reference of references) {
      this.validateOfferRef(reference);
      const key = reference.kind === ApplicationBriefConstants.OFFER_REF_KIND.SENIORITY
        ? reference.kind : `${reference.kind}:${reference.index}`;
      if (keys.has(key)) {
        this.fail("Offer reference is duplicated");
      }
      keys.add(key);
    }
  }

  /**
   * Validate a bounded evidence reference array without duplicates.
   * @param {unknown} references - Evidence reference candidates.
   * @param {boolean} nonEmpty - Whether at least one reference is required.
   * @returns {void}
   */
  validateEvidenceRefs(references, nonEmpty) {
    this.requireArray(references, ApplicationBriefLimits.MAX_REFS_PER_ITEM, "evidence references");
    if (nonEmpty && references.length === 0) {
      this.fail("Evidence references must not be empty");
    }
    const keys = new Set();
    for (const reference of references) {
      this.validateEvidenceRef(reference);
      const key = this.evidenceRefKey(reference);
      if (keys.has(key)) {
        this.fail("Evidence reference is duplicated");
      }
      keys.add(key);
    }
  }

  /**
   * Validate one structured candidate evidence reference and its closed field vocabulary.
   * @param {unknown} reference - Evidence reference candidate.
   * @returns {void}
   */
  validateEvidenceRef(reference) {
    this.requireExactObject(reference, EVIDENCE_REF_KEYS, "evidence reference");
    this.requireEnum(reference.kind, ApplicationBriefConstants.EVIDENCE_KIND, "evidence kind");
    if (typeof reference.itemId !== "string" || !reference.itemId.trim()
      || reference.itemId.length > CandidateDossierLimits.MAXIMUM_ID_LENGTH
      || !ID_PATTERN.test(reference.itemId)) {
      this.fail("Evidence item id is invalid");
    }
    if (typeof reference.field !== "string") {
      this.fail("Evidence field is invalid");
    }
    if (SCALAR_FIELDS[reference.kind].includes(reference.field)) {
      return;
    }
    const match = ARRAY_FIELD_PATTERN.exec(reference.field);
    if (!match || ![
      ApplicationBriefConstants.EVIDENCE_KIND.EXPERIENCE,
      ApplicationBriefConstants.EVIDENCE_KIND.PROJECT,
    ].includes(reference.kind)) {
      this.fail("Evidence field is invalid");
    }
    const index = Number(match[2]);
    const maximum = match[1] === "activities" ? CandidateDossierLimits.MAXIMUM_ACTIVITIES
      : match[1] === "achievements" ? CandidateDossierLimits.MAXIMUM_ACHIEVEMENTS
        : CandidateDossierLimits.MAXIMUM_TECHNOLOGIES;
    if (index >= maximum) {
      this.fail("Evidence array field index exceeds its structural limit");
    }
  }

  /**
   * Reject exact structurally identical entries while preserving input order.
   * @param {Set<string>} signatures - Previously observed signatures.
   * @param {object} value - Validated item.
   * @param {string} message - Controlled duplicate message.
   * @returns {void}
   */
  rejectDuplicateSignature(signatures, value, message) {
    const signature = JSON.stringify(this.canonicalizeForSignature(value));
    if (signatures.has(signature)) {
      this.fail(message);
    }
    signatures.add(signature);
  }

  /**
   * Canonically order validated item keys for insertion-order-independent duplicate checks.
   * @param {unknown} value - Validated JSON-compatible item value.
   * @returns {unknown} Canonically keyed signature value.
   */
  canonicalizeForSignature(value) {
    if (Array.isArray(value)) {
      return value.map((item) => {
        return this.canonicalizeForSignature(item);
      });
    }
    if (value !== null && typeof value === "object") {
      const canonical = {};
      for (const key of Object.keys(value).sort()) {
        canonical[key] = this.canonicalizeForSignature(value[key]);
      }
      return canonical;
    }
    return value;
  }

  /**
   * Add structured reference identities to one union set.
   * @param {Set<string>} destination - Target set.
   * @param {object[]} references - Evidence references.
   * @returns {void}
   */
  addEvidenceRefKeys(destination, references) {
    for (const reference of references) {
      destination.add(this.evidenceRefKey(reference));
    }
  }

  /**
   * Build the collection-aware identity of one candidate evidence reference.
   * @param {object} reference - Valid evidence reference.
   * @returns {string} Exact reference identity.
   */
  evidenceRefKey(reference) {
    return JSON.stringify([reference.kind, reference.itemId, reference.field]);
  }

  /**
   * Require one exact object key whitelist.
   * @param {unknown} value - Object candidate.
   * @param {string[]} keys - Exact required keys.
   * @param {string} label - Controlled label.
   * @returns {void}
   */
  requireExactObject(value, keys, label) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      this.fail(`${label} must be an object`);
    }
    const actual = Object.keys(value);
    if (actual.some((key) => {
      return !keys.includes(key);
    })) {
      this.fail(`${label} contains an unknown field`);
    }
    if (actual.length !== keys.length) {
      this.fail(`${label} requires every field`);
    }
  }

  /**
   * Require one bounded array.
   * @param {unknown} value - Array candidate.
   * @param {number} maximum - Maximum cardinality.
   * @param {string} label - Controlled label.
   * @returns {void}
   */
  requireArray(value, maximum, label) {
    if (!Array.isArray(value)) {
      this.fail(`${label} must be an array`);
    }
    if (value.length > maximum) {
      this.fail(`${label} exceeds its limit`);
    }
  }

  /**
   * Require an exact closed enum value.
   * @param {unknown} value - Enum candidate.
   * @param {object} vocabulary - Closed enum object.
   * @param {string} label - Controlled label.
   * @returns {void}
   */
  requireEnum(value, vocabulary, label) {
    if (!Object.values(vocabulary).includes(value)) {
      this.fail(`${label} is invalid`);
    }
  }

  /**
   * Require a non-empty bounded string without rewriting it.
   * @param {unknown} value - String candidate.
   * @param {number} maximum - Maximum String.length.
   * @param {string} label - Controlled label.
   * @returns {void}
   */
  requireText(value, maximum, label) {
    if (typeof value !== "string" || !value.trim()) {
      this.fail(`${label} must be a non-empty string`);
    }
    if (value.length > maximum) {
      this.fail(`${label} exceeds its limit`);
    }
  }

  /**
   * Require a lowercase hexadecimal SHA-256 value.
   * @param {unknown} value - Hash candidate.
   * @param {string} label - Controlled label.
   * @returns {void}
   */
  requireHash(value, label) {
    if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
      this.fail(`${label} is invalid`);
    }
  }

  /**
   * Require a positive safe integer.
   * @param {unknown} value - Integer candidate.
   * @param {string} label - Controlled label.
   * @returns {void}
   */
  requirePositiveInteger(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      this.fail(`${label} must be a positive safe integer`);
    }
  }

  /**
   * Require a non-negative safe integer.
   * @param {unknown} value - Integer candidate.
   * @param {string} label - Controlled label.
   * @returns {void}
   */
  requireNonNegativeInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
      this.fail(`${label} must be a non-negative safe integer`);
    }
  }

  /**
   * Throw one closed ApplicationBrief validation error.
   * @param {string} message - Controlled validation message.
   * @returns {never}
   */
  fail(message) {
    throw new ApplicationBriefValidationError(message);
  }
}

export { ApplicationBriefValidator };
