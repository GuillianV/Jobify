import { ApplicationBriefConstants } from "../constants/ApplicationBriefConstants.js";

const OFFER_IDENTITY_KEYS = Object.freeze([
  "offerId", "analysisFingerprint", "analysisSchemaVersion", "analyzerPolicyVersion",
]);

/**
 * Deterministically assembles semantic decisions with authoritative identities and facts.
 */
class ApplicationBriefAssembler {
  /**
   * Create the assembler from deterministic evidence and fingerprint primitives.
   * @param {object} dependencies - Assembly dependencies.
   * @param {import("./ApplicationBriefEvidenceResolver.js").ApplicationBriefEvidenceResolver} dependencies.evidenceResolver - Candidate evidence resolver.
   * @param {typeof import("./CandidateDossierFingerprint.js").CandidateDossierFingerprint} dependencies.candidateFingerprint - Candidate fingerprint primitive.
   */
  constructor({ evidenceResolver, candidateFingerprint }) {
    this.evidenceResolver = evidenceResolver;
    this.candidateFingerprint = candidateFingerprint;
  }

  /**
   * Assemble one detached final brief candidate without semantic repair.
   * @param {object} inputs - Validated semantics and authoritative inputs.
   * @param {object} inputs.semanticOutput - Validated semantic output.
   * @param {object} inputs.offerIdentity - Authoritative offer identity.
   * @param {import("../models/CandidateDossier.js").CandidateDossier} inputs.candidateDossier - Candidate dossier.
   * @returns {object} Plain complete ApplicationBrief candidate.
   */
  assemble({ semanticOutput, offerIdentity, candidateDossier }) {
    const semantic = structuredClone(semanticOutput);
    return {
      schemaVersion: ApplicationBriefConstants.SCHEMA_VERSION,
      inputIdentity: {
        offer: this.copyOfferIdentity(offerIdentity),
        candidate: {
          fingerprint: this.candidateFingerprint.compute(candidateDossier),
          schemaVersion: candidateDossier.schemaVersion,
        },
      },
      requirementMatches: semantic.requirementMatches,
      evidenceFacts: this.buildEvidenceFacts(semantic, candidateDossier),
      emphasis: semantic.emphasis,
      supportedClaims: semantic.supportedClaims,
      cautions: semantic.cautions,
    };
  }

  /**
   * Copy exactly the four authoritative offer identity components.
   * @param {object} identity - Authoritative identity.
   * @returns {object} Detached exact offer identity.
   */
  copyOfferIdentity(identity) {
    return Object.fromEntries(OFFER_IDENTITY_KEYS.map((key) => {
      return [key, structuredClone(identity[key])];
    }));
  }

  /**
   * Resolve every unique used evidence reference in first-occurrence order.
   * @param {object} semantic - Detached semantic output.
   * @param {import("../models/CandidateDossier.js").CandidateDossier} dossier - Candidate dossier.
   * @returns {object[]} Exact deterministic evidence facts.
   */
  buildEvidenceFacts(semantic, dossier) {
    const references = this.collectEvidenceRefs(semantic);
    return references.map((reference) => {
      return {
        ref: structuredClone(reference),
        value: this.evidenceResolver.resolve(dossier, reference),
      };
    });
  }

  /**
   * Collect and stably deduplicate evidence refs across all semantic roots.
   * @param {object} semantic - Validated semantic output.
   * @returns {object[]} Detached unique refs in first-occurrence order.
   */
  collectEvidenceRefs(semantic) {
    const unique = new Map();
    for (const match of semantic.requirementMatches) {
      for (const facet of match.supportedFacets) {
        this.addEvidenceRefs(unique, facet.evidenceRefs);
      }
    }
    for (const item of semantic.emphasis) {
      this.addEvidenceRefs(unique, item.evidenceRefs);
    }
    for (const item of semantic.supportedClaims) {
      this.addEvidenceRefs(unique, item.evidenceRefs);
    }
    for (const item of semantic.cautions) {
      this.addEvidenceRefs(unique, item.evidenceRefs);
    }
    return [...unique.values()];
  }

  /**
   * Add refs to a stable identity map without replacing first occurrences.
   * @param {Map<string, object>} unique - Stable unique ref map.
   * @param {object[]} references - References to add.
   * @returns {void}
   */
  addEvidenceRefs(unique, references) {
    for (const reference of references) {
      const key = `${reference.kind}:${reference.itemId}:${reference.field}`;
      if (!unique.has(key)) {
        unique.set(key, structuredClone(reference));
      }
    }
  }
}

export { ApplicationBriefAssembler };
