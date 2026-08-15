import { ApplicationBriefLimits } from "../constants/ApplicationBriefLimits.js";
import { CandidateDossierConstants } from "../constants/CandidateDossierConstants.js";
import { OfferAnalysisConstants } from "../constants/OfferAnalysisConstants.js";
import { CandidateDossier } from "../models/CandidateDossier.js";
import { OfferAnalysis } from "../models/OfferAnalysis.js";
import { ApplicationBriefContextValidationError } from "./ApplicationBriefContextValidationError.js";

const CONTEXT_KEYS = Object.freeze(["offerAnalysis", "offerIdentity", "candidateDossier"]);
const OFFER_IDENTITY_KEYS = Object.freeze([
  "offerId", "analysisFingerprint", "analysisSchemaVersion", "analyzerPolicyVersion",
]);
const HASH_PATTERN = /^[a-f0-9]{64}$/u;

/**
 * Validates a structural ApplicationBrief against authoritative offer and candidate inputs.
 */
class ApplicationBriefContextValidator {
  /**
   * Create the contextual validator from deterministic collaborators.
   * @param {object} dependencies - Validation collaborators.
   * @param {import("./ApplicationBriefValidator.js").ApplicationBriefValidator} dependencies.applicationBriefValidator - Pure structural validator.
   * @param {import("./ApplicationBriefOfferRefResolver.js").ApplicationBriefOfferRefResolver} dependencies.offerRefResolver - Offer resolver.
   * @param {import("./ApplicationBriefEvidenceResolver.js").ApplicationBriefEvidenceResolver} dependencies.evidenceResolver - Candidate resolver.
   * @param {typeof import("./CandidateDossierFingerprint.js").CandidateDossierFingerprint} dependencies.candidateFingerprint - Candidate fingerprint primitive.
   */
  constructor({
    applicationBriefValidator,
    offerRefResolver,
    evidenceResolver,
    candidateFingerprint,
  }) {
    this.applicationBriefValidator = applicationBriefValidator;
    this.offerRefResolver = offerRefResolver;
    this.evidenceResolver = evidenceResolver;
    this.candidateFingerprint = candidateFingerprint;
  }

  /**
   * Validate structure first and then every cross-input invariant without mutation.
   * @param {unknown} candidate - Untrusted ApplicationBrief candidate.
   * @param {unknown} context - Authoritative offer and candidate context.
   * @returns {import("../models/ApplicationBrief.js").ApplicationBrief} Structurally validated unchanged brief.
   */
  validate(candidate, context) {
    const brief = this.applicationBriefValidator.validate(candidate);
    this.validateAuthoritativeContext(context);
    this.validateCandidateIdentity(brief, context.candidateDossier);
    this.validateOfferIdentity(brief, context.offerIdentity);
    this.validateRequirementCoverage(brief, context.offerAnalysis);
    this.validateEvidenceFacts(brief, context.candidateDossier);
    this.validateRequirementFacets(brief, context.offerAnalysis);
    this.validateRemainingOfferRefs(brief, context.offerAnalysis);
    return brief;
  }

  /**
   * Require validated domain inputs and one minimal exact authoritative identity shape.
   * @param {unknown} context - Context candidate.
   * @returns {void}
   */
  validateAuthoritativeContext(context) {
    if (!this.hasExactKeys(context, CONTEXT_KEYS)
      || !(context.offerAnalysis instanceof OfferAnalysis)
      || !(context.candidateDossier instanceof CandidateDossier)
      || !this.isValidOfferIdentity(context.offerIdentity)) {
      this.fail(ApplicationBriefContextValidationError.REASON.STALE_INPUT);
    }
  }

  /**
   * Validate the server-supplied offer identity without deriving a second fingerprint.
   * @param {unknown} identity - Authoritative identity candidate.
   * @returns {boolean} Whether the identity has its exact safe shape.
   */
  isValidOfferIdentity(identity) {
    return this.hasExactKeys(identity, OFFER_IDENTITY_KEYS)
      && Number.isSafeInteger(identity.offerId)
      && identity.offerId > 0
      && typeof identity.analysisFingerprint === "string"
      && HASH_PATTERN.test(identity.analysisFingerprint)
      && identity.analysisSchemaVersion === OfferAnalysisConstants.SCHEMA_VERSION
      && typeof identity.analyzerPolicyVersion === "string"
      && Boolean(identity.analyzerPolicyVersion.trim())
      && identity.analyzerPolicyVersion.length
        <= ApplicationBriefLimits.MAX_ANALYZER_POLICY_VERSION_LENGTH;
  }

  /**
   * Verify candidate schema and exact deterministic content fingerprint.
   * @param {import("../models/ApplicationBrief.js").ApplicationBrief} brief - Structural brief.
   * @param {CandidateDossier} dossier - Authoritative candidate dossier.
   * @returns {void}
   */
  validateCandidateIdentity(brief, dossier) {
    const expected = brief.inputIdentity.candidate;
    if (dossier.schemaVersion !== CandidateDossierConstants.SCHEMA_VERSION
      || expected.schemaVersion !== dossier.schemaVersion
      || expected.fingerprint !== this.candidateFingerprint.compute(dossier)) {
      this.fail(ApplicationBriefContextValidationError.REASON.STALE_INPUT);
    }
  }

  /**
   * Verify every brief offer identity component against the injected authority.
   * @param {import("../models/ApplicationBrief.js").ApplicationBrief} brief - Structural brief.
   * @param {object} identity - Valid authoritative offer identity.
   * @returns {void}
   */
  validateOfferIdentity(brief, identity) {
    const expected = brief.inputIdentity.offer;
    if (expected.offerId !== identity.offerId
      || expected.analysisFingerprint !== identity.analysisFingerprint
      || expected.analysisSchemaVersion !== identity.analysisSchemaVersion
      || expected.analyzerPolicyVersion !== identity.analyzerPolicyVersion) {
      this.fail(ApplicationBriefContextValidationError.REASON.STALE_INPUT);
    }
  }

  /**
   * Require exactly one match for every authoritative OfferAnalysis requirement.
   * @param {import("../models/ApplicationBrief.js").ApplicationBrief} brief - Structural brief.
   * @param {OfferAnalysis} analysis - Authoritative offer analysis.
   * @returns {void}
   */
  validateRequirementCoverage(brief, analysis) {
    if (brief.requirementMatches.length !== analysis.requirements.length) {
      this.fail(
        ApplicationBriefContextValidationError.REASON.INCOMPLETE_REQUIREMENT_COVERAGE,
      );
    }
    const covered = new Set(brief.requirementMatches.map((match) => {
      return match.offerRef.index;
    }));
    for (const index of analysis.requirements.keys()) {
      if (!covered.has(index)) {
        this.fail(
          ApplicationBriefContextValidationError.REASON.INCOMPLETE_REQUIREMENT_COVERAGE,
        );
      }
    }
  }

  /**
   * Resolve every unique evidence fact and compare its exact candidate value.
   * @param {import("../models/ApplicationBrief.js").ApplicationBrief} brief - Structural brief.
   * @param {CandidateDossier} dossier - Authoritative candidate dossier.
   * @returns {void}
   */
  validateEvidenceFacts(brief, dossier) {
    for (const fact of brief.evidenceFacts) {
      const resolved = this.evidenceResolver.resolve(dossier, fact.ref);
      if (fact.value !== resolved) {
        this.fail(ApplicationBriefContextValidationError.REASON.EVIDENCE_VALUE_MISMATCH);
      }
    }
  }

  /**
   * Resolve every requirement match and require exact substring facets.
   * @param {import("../models/ApplicationBrief.js").ApplicationBrief} brief - Structural brief.
   * @param {OfferAnalysis} analysis - Authoritative offer analysis.
   * @returns {void}
   */
  validateRequirementFacets(brief, analysis) {
    for (const match of brief.requirementMatches) {
      const requirement = this.offerRefResolver.resolve(analysis, match.offerRef);
      for (const facet of [...match.supportedFacets, ...match.notEvidencedFacets]) {
        if (!requirement.value.includes(facet.text)) {
          this.fail(ApplicationBriefContextValidationError.REASON.FACET_NOT_IN_REQUIREMENT);
        }
      }
    }
  }

  /**
   * Resolve every non-match offer reference used by semantic output collections.
   * @param {import("../models/ApplicationBrief.js").ApplicationBrief} brief - Structural brief.
   * @param {OfferAnalysis} analysis - Authoritative offer analysis.
   * @returns {void}
   */
  validateRemainingOfferRefs(brief, analysis) {
    for (const item of [...brief.emphasis, ...brief.supportedClaims, ...brief.cautions]) {
      for (const reference of item.offerRefs) {
        this.offerRefResolver.resolve(analysis, reference);
      }
    }
  }

  /**
   * Test one exact plain-object key set without rewriting the object.
   * @param {unknown} value - Object candidate.
   * @param {string[]} expectedKeys - Exact keys.
   * @returns {boolean} Whether the value is one exact plain object shape.
   */
  hasExactKeys(value, expectedKeys) {
    if (value === null || typeof value !== "object" || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) {
      return false;
    }
    const keys = Object.keys(value);
    return keys.length === expectedKeys.length && keys.every((key) => {
      return expectedKeys.includes(key);
    });
  }

  /**
   * Throw one closed contextual validation error.
   * @param {string} reason - Closed contextual reason.
   * @returns {never}
   */
  fail(reason) {
    throw new ApplicationBriefContextValidationError(reason);
  }
}

export { ApplicationBriefContextValidator };
