import { ApplicationBriefConstants } from "../constants/ApplicationBriefConstants.js";

const ARRAY_FIELD_PATTERN = /^(activities|achievements|technologies)\[(0|[1-9]\d*)\]$/u;

const CLAIM_TYPE = Object.freeze({
  EXPERIENCE_FACT: "experience",
  PROJECT_FACT: "project",
  SKILL_DECLARATION: "skill",
  EDUCATION_FACT: "education",
  LANGUAGE_DECLARATION: "language",
  SOFT_SKILL_DECLARATION: "softSkill",
});

const EVIDENCE_SOURCE = Object.freeze({
  EXPERIENCE: "experience",
  PROJECT: "project",
  SKILL: "skill",
  EDUCATION: "education",
  LANGUAGE: "language",
  SOFT_SKILL: "softSkill",
});

const SCALAR_ATTRIBUTE = Object.freeze({
  EXPERIENCE: Object.freeze({
    role: "role", organization: "organization", client: "client",
    startDate: "startDate", endDate: "endDate", current: "current", domain: "domain",
  }),
  PROJECT: Object.freeze({
    name: "projectName", role: "role", startDate: "startDate", endDate: "endDate",
    domain: "domain", summary: "summary",
  }),
  SKILL: Object.freeze({ category: "skillCategory", value: "skill", detail: "detail" }),
  EDUCATION: Object.freeze({
    diploma: "diploma", level: "level", field: "educationField",
    institution: "institution", startDate: "startDate", endDate: "endDate",
  }),
  LANGUAGE: Object.freeze({
    language: "language", overall: "overall", reading: "reading", writing: "writing",
    speaking: "speaking", listening: "listening",
  }),
  SOFT_SKILL: Object.freeze({ value: "softSkill", detail: "detail" }),
});

const ARRAY_ATTRIBUTE = Object.freeze({
  activities: "activity",
  achievements: "achievement",
  technologies: "technology",
});

const PRIORITY = Object.freeze({ PRIMARY: "primary", SECONDARY: "secondary" });

const CAUTION_TYPE = Object.freeze({
  EXPERTISE_LEVEL_UNSUPPORTED: "expertiseLevel",
  DURATION_UNSUPPORTED: "duration",
  LEADERSHIP_UNSUPPORTED: "leadership",
  LANGUAGE_LEVEL_UNSUPPORTED: "languageLevel",
  SCOPE_GENERALIZATION_UNSUPPORTED: "scopeGeneralization",
});

const SENIORITY_VALUE = Object.freeze({
  JUNIOR: "junior",
  CONFIRMED: "confirmed",
  SENIOR: "senior",
  LEAD: "lead",
  MANAGER: "manager",
});

/**
 * Produces the minimal detached factual and boundary input for cover-letter generation.
 */
class CoverLetterInputProjector {
  /**
   * Create the projector with the authoritative offer-reference resolver.
   * @param {object} dependencies - Deterministic collaborators.
   * @param {import("./ApplicationBriefOfferRefResolver.js").ApplicationBriefOfferRefResolver} dependencies.offerRefResolver - Offer fact resolver.
   */
  constructor({ offerRefResolver }) {
    if (offerRefResolver === null || typeof offerRefResolver?.resolve !== "function") {
      throw new TypeError("CoverLetterInputProjector requires an offer reference resolver");
    }
    this.offerRefResolver = offerRefResolver;
  }

  /**
   * Project one validated brief with its authoritative offer context.
   * @param {object} inputs - Validated generation inputs.
   * @param {import("../models/ApplicationBrief.js").ApplicationBrief} inputs.applicationBrief - Validated application brief.
   * @param {import("../models/OfferAnalysis.js").OfferAnalysis} inputs.offerAnalysis - Authoritative offer analysis.
   * @param {object} inputs.offerSnapshot - Authoritative minimal offer snapshot.
   * @returns {object} Detached JSON-compatible generation projection.
   */
  project({ applicationBrief, offerAnalysis, offerSnapshot }) {
    this.validateResolvableOfferRefs(applicationBrief, offerAnalysis);
    const facts = this.buildEvidenceFactLookup(applicationBrief.evidenceFacts);
    const requirementMatches = this.buildRequirementMatchLookup(
      applicationBrief.requirementMatches,
    );
    const claims = applicationBrief.supportedClaims.map((claim, index) => {
      return this.projectClaim({
        claim, index, applicationBrief, offerAnalysis, facts, requirementMatches,
      });
    });
    return {
      offer: this.projectOffer(offerSnapshot),
      claims,
      boundaries: this.projectBoundaries(applicationBrief, claims),
    };
  }

  /**
   * Resolve every brief offer reference before projecting any positive or negative context.
   * @param {import("../models/ApplicationBrief.js").ApplicationBrief} brief - Validated brief.
   * @param {import("../models/OfferAnalysis.js").OfferAnalysis} analysis - Offer analysis.
   * @returns {void}
   */
  validateResolvableOfferRefs(brief, analysis) {
    for (const match of brief.requirementMatches) {
      this.offerRefResolver.resolve(analysis, match.offerRef);
    }
    for (const item of [...brief.emphasis, ...brief.supportedClaims, ...brief.cautions]) {
      for (const reference of item.offerRefs) {
        this.offerRefResolver.resolve(analysis, reference);
      }
    }
  }

  /**
   * Select exact title and nullable company name from the authoritative snapshot.
   * @param {object} snapshot - Offer-analysis input snapshot.
   * @returns {object} Minimal offer identity for prose generation.
   */
  projectOffer(snapshot) {
    if (snapshot === null || typeof snapshot !== "object"
      || typeof snapshot.title !== "string" || !snapshot.title.trim()) {
      this.fail("Cover letter projection requires an authoritative offer title");
    }
    const company = snapshot.company?.name ?? null;
    if (company !== null && (typeof company !== "string" || !company.trim())) {
      this.fail("Cover letter projection company is invalid");
    }
    return { title: snapshot.title, company };
  }

  /**
   * Project one supported claim and only its referenced candidate evidence.
   * @param {object} context - Claim projection context.
   * @returns {object} Minimal supported claim.
   */
  projectClaim({ claim, index, applicationBrief, offerAnalysis, facts, requirementMatches }) {
    const type = CLAIM_TYPE[claim.claimType];
    if (type === undefined) {
      this.fail("Cover letter claim type is unsupported");
    }
    const emphasis = this.resolveEmphasis(claim, applicationBrief.emphasis);
    return {
      index,
      type,
      candidateEvidence: this.projectCandidateEvidence(claim.evidenceRefs, facts),
      relatedOfferElements: this.projectOfferElements(
        claim.offerRefs,
        offerAnalysis,
        requirementMatches,
      ),
      priority: emphasis === null ? null : this.mapPriority(emphasis.priority),
      strategyReason: emphasis === null ? null : emphasis.relevanceReason,
    };
  }

  /**
   * Build one exact evidence-fact registry and reject duplicate identities.
   * @param {object[]} evidenceFacts - Validated brief fact registry.
   * @returns {Map<string, object>} Exact fact lookup.
   */
  buildEvidenceFactLookup(evidenceFacts) {
    const lookup = new Map();
    for (const fact of evidenceFacts) {
      const key = this.evidenceRefKey(fact.ref);
      if (lookup.has(key)) {
        this.fail("Cover letter evidence fact reference is duplicated");
      }
      lookup.set(key, fact);
    }
    return lookup;
  }

  /**
   * Group claim facts by exact candidate item identity without exposing that identity.
   * @param {object[]} references - Claim evidence references in brief order.
   * @param {Map<string, object>} facts - Exact brief fact lookup.
   * @returns {object[]} Stable candidate evidence groups.
   */
  projectCandidateEvidence(references, facts) {
    const groups = new Map();
    const seen = new Set();
    for (const reference of references) {
      const referenceKey = this.evidenceRefKey(reference);
      if (seen.has(referenceKey)) {
        this.fail("Cover letter claim evidence reference is duplicated");
      }
      seen.add(referenceKey);
      const fact = facts.get(referenceKey);
      if (fact === undefined) {
        this.fail("Cover letter claim evidence reference is unresolved");
      }
      const source = EVIDENCE_SOURCE[reference.kind];
      const attribute = this.mapAttribute(reference);
      if (source === undefined) {
        this.fail("Cover letter evidence source is unsupported");
      }
      const groupKey = JSON.stringify([reference.kind, reference.itemId]);
      if (!groups.has(groupKey)) {
        groups.set(groupKey, { source, facts: [] });
      }
      groups.get(groupKey).facts.push({ attribute, value: fact.value });
    }
    return [...groups.values()];
  }

  /**
   * Map one technical evidence field to the closed generation vocabulary.
   * @param {object} reference - Validated evidence reference.
   * @returns {string} User-readable attribute.
   */
  mapAttribute(reference) {
    const scalar = SCALAR_ATTRIBUTE[reference.kind]?.[reference.field];
    if (scalar !== undefined) {
      return scalar;
    }
    const match = ARRAY_FIELD_PATTERN.exec(reference.field);
    const attribute = match === null ? undefined : ARRAY_ATTRIBUTE[match[1]];
    if (attribute === undefined
      || ![ApplicationBriefConstants.EVIDENCE_KIND.EXPERIENCE,
        ApplicationBriefConstants.EVIDENCE_KIND.PROJECT].includes(reference.kind)) {
      this.fail("Cover letter evidence field is unsupported");
    }
    return attribute;
  }

  /**
   * Build a unique requirement-match lookup by authoritative requirement index.
   * @param {object[]} matches - Validated requirement matches.
   * @returns {Map<number, object>} Requirement match lookup.
   */
  buildRequirementMatchLookup(matches) {
    const lookup = new Map();
    for (const match of matches) {
      const index = match.offerRef.index;
      if (lookup.has(index)) {
        this.fail("Cover letter requirement match is duplicated");
      }
      lookup.set(index, match);
    }
    return lookup;
  }

  /**
   * Resolve claim offer refs as bounded offer context without candidate assertions.
   * @param {object[]} references - Claim offer references.
   * @param {import("../models/OfferAnalysis.js").OfferAnalysis} analysis - Offer analysis.
   * @param {Map<number, object>} matches - Requirement match lookup.
   * @returns {object[]} Stable related offer elements.
   */
  projectOfferElements(references, analysis, matches) {
    const elements = [];
    for (const reference of references) {
      const kind = reference.kind;
      if (kind === ApplicationBriefConstants.OFFER_REF_KIND.REQUIREMENT) {
        this.offerRefResolver.resolve(analysis, reference);
        const match = matches.get(reference.index);
        if (match === undefined) {
          this.fail("Cover letter requirement match is missing");
        }
        if (match.state === ApplicationBriefConstants.EVIDENCE_STATE.NOT_EVIDENCED) {
          this.fail("A not-evidenced requirement cannot support a cover letter claim");
        }
        for (const facet of match.supportedFacets) {
          elements.push({ type: "requirement", value: facet.text });
        }
      } else if (kind === ApplicationBriefConstants.OFFER_REF_KIND.ACTIVITY) {
        const activity = this.offerRefResolver.resolve(analysis, reference);
        elements.push({ type: "activity", value: activity.value });
      } else if (kind === ApplicationBriefConstants.OFFER_REF_KIND.CONTEXT) {
        const context = this.offerRefResolver.resolve(analysis, reference);
        elements.push({ type: "context", value: context.value });
      } else if (kind === ApplicationBriefConstants.OFFER_REF_KIND.SENIORITY) {
        const seniority = this.offerRefResolver.resolve(analysis, reference);
        for (const level of seniority.levels) {
          const value = SENIORITY_VALUE[level];
          if (value === undefined) {
            this.fail("Cover letter seniority level is unsupported");
          }
          elements.push({ type: "seniority", value });
        }
      } else {
        this.fail("Cover letter offer reference kind is unsupported");
      }
    }
    return elements;
  }

  /**
   * Resolve a uniquely meaningful emphasis using exact reference-set identity.
   * @param {object} claim - Supported claim.
   * @param {object[]} emphasis - Strategy entries.
   * @returns {object|null} Selected strategy entry or null.
   */
  resolveEmphasis(claim, emphasis) {
    const matching = emphasis.filter((entry) => {
      return this.hasSharedReference(entry.offerRefs, claim.offerRefs, (reference) => {
        return this.offerRefKey(reference);
      }) && this.hasSharedReference(entry.evidenceRefs, claim.evidenceRefs, (reference) => {
        return this.evidenceRefKey(reference);
      });
    });
    if (matching.length === 0) {
      return null;
    }
    const primary = matching.filter((entry) => {
      return entry.priority === ApplicationBriefConstants.PRIORITY.PRIMARY;
    });
    const selected = primary.length > 0 ? primary : matching;
    const reason = selected[0].relevanceReason;
    if (selected.some((entry) => {
      return entry.relevanceReason !== reason;
    })) {
      this.fail("Cover letter emphasis is ambiguous");
    }
    return selected[0];
  }

  /**
   * Map one closed emphasis priority without exposing its technical enum.
   * @param {string} priority - Brief priority.
   * @returns {string} Generation priority.
   */
  mapPriority(priority) {
    const mapped = PRIORITY[priority];
    if (mapped === undefined) {
      this.fail("Cover letter emphasis priority is unsupported");
    }
    return mapped;
  }

  /**
   * Project every negative generation boundary in brief order.
   * @param {import("../models/ApplicationBrief.js").ApplicationBrief} brief - Validated brief.
   * @param {object[]} claims - Projected supported claims.
   * @returns {object} Detached generation boundaries.
   */
  projectBoundaries(brief, claims) {
    const state = ApplicationBriefConstants.EVIDENCE_STATE;
    return {
      partialRequirements: brief.requirementMatches.filter((match) => {
        return match.state === state.PARTIALLY_SUPPORTED;
      }).map((match) => {
        return {
          supportedFacets: match.supportedFacets.map((facet) => {
            return facet.text;
          }),
          notEvidencedFacets: match.notEvidencedFacets.map((facet) => {
            return facet.text;
          }),
        };
      }),
      notEvidencedFacets: brief.requirementMatches.filter((match) => {
        return match.state === state.NOT_EVIDENCED;
      }).flatMap((match) => {
        return match.notEvidencedFacets.map((facet) => {
          return facet.text;
        });
      }),
      cautions: brief.cautions.map((caution) => {
        return this.projectCaution(caution, brief.supportedClaims, claims);
      }),
    };
  }

  /**
   * Preserve one caution and relate it only through shared offer and evidence refs.
   * @param {object} caution - Brief caution.
   * @param {object[]} supportedClaims - Brief supported claims.
   * @param {object[]} projectedClaims - Projected claims carrying original indexes.
   * @returns {object} Closed generation caution.
   */
  projectCaution(caution, supportedClaims, projectedClaims) {
    const type = CAUTION_TYPE[caution.kind];
    if (type === undefined) {
      this.fail("Cover letter caution kind is unsupported");
    }
    const relatedClaimIndexes = supportedClaims.flatMap((claim, index) => {
      const sharedOffer = this.hasSharedReference(
        caution.offerRefs,
        claim.offerRefs,
        (reference) => {
          return this.offerRefKey(reference);
        },
      );
      const sharedEvidence = this.hasSharedReference(
        caution.evidenceRefs,
        claim.evidenceRefs,
        (reference) => {
          return this.evidenceRefKey(reference);
        },
      );
      return sharedOffer && sharedEvidence ? [projectedClaims[index].index] : [];
    });
    return { type, relatedClaimIndexes };
  }

  /**
   * Determine whether two reference collections share one exact identity.
   * @param {object[]} first - First references.
   * @param {object[]} second - Second references.
   * @param {Function} keyBuilder - Reference key builder.
   * @returns {boolean} Whether one identity is shared.
   */
  hasSharedReference(first, second, keyBuilder) {
    const keys = new Set(first.map((reference) => {
      return keyBuilder(reference);
    }));
    return second.some((reference) => {
      return keys.has(keyBuilder(reference));
    });
  }

  /**
   * Build one collection-aware evidence reference identity.
   * @param {object} reference - Evidence reference.
   * @returns {string} Canonical identity.
   */
  evidenceRefKey(reference) {
    return JSON.stringify([reference.kind, reference.itemId, reference.field]);
  }

  /**
   * Build one offer reference identity including index only where defined.
   * @param {object} reference - Offer reference.
   * @returns {string} Canonical identity.
   */
  offerRefKey(reference) {
    return JSON.stringify(reference.kind === ApplicationBriefConstants.OFFER_REF_KIND.SENIORITY
      ? [reference.kind] : [reference.kind, reference.index]);
  }

  /**
   * Reject one projection inconsistency without repairing input.
   * @param {string} message - Controlled internal failure description.
   * @returns {never}
   */
  fail(message) {
    throw new TypeError(message);
  }
}

export { CoverLetterInputProjector };
