import { ApplicationBriefConstants } from "../constants/ApplicationBriefConstants.js";

/**
 * Produces the minimal detached factual input for the future semantic matcher.
 * This projection is never an authoritative source for contextual validation.
 */
class ApplicationBriefInputProjector {
  /**
   * Project authoritative offer and candidate domain inputs without semantic decisions.
   * @param {object} inputs - Validated domain inputs and contextual offer snapshot.
   * @param {import("../models/OfferAnalysis.js").OfferAnalysis} inputs.offerAnalysis - Offer analysis.
   * @param {object} inputs.offerSnapshot - Contextual offer snapshot.
   * @param {import("../models/CandidateDossier.js").CandidateDossier} inputs.candidateDossier - Candidate facts.
   * @returns {object} Detached minimal matcher input.
   */
  project({ offerAnalysis, offerSnapshot, candidateDossier }) {
    return {
      offer: this.projectOffer(offerAnalysis, offerSnapshot),
      candidate: this.projectCandidate(candidateDossier),
    };
  }

  /**
   * Project only match-relevant offer semantics with stable references.
   * @param {import("../models/OfferAnalysis.js").OfferAnalysis} analysis - Offer analysis.
   * @param {object} snapshot - Contextual offer snapshot.
   * @returns {object} Minimal detached offer projection.
   */
  projectOffer(analysis, snapshot) {
    const kinds = ApplicationBriefConstants.OFFER_REF_KIND;
    return {
      title: snapshot.title ?? null,
      seniority: analysis.seniority === null ? null : {
        ref: { kind: kinds.SENIORITY },
        levels: [...analysis.seniority.levels],
      },
      activities: analysis.activities.map((item, index) => {
        return { ref: { kind: kinds.ACTIVITY, index }, value: item.value };
      }),
      requirements: analysis.requirements.map((item, index) => {
        return {
          ref: { kind: kinds.REQUIREMENT, index },
          category: item.category,
          value: item.value,
          importance: item.importance,
        };
      }),
      context: analysis.context.map((item, index) => {
        return {
          ref: { kind: kinds.CONTEXT, index },
          category: item.category,
          value: item.value,
        };
      }),
    };
  }

  /**
   * Project all factual candidate fields needed to construct resolvable evidence references.
   * @param {import("../models/CandidateDossier.js").CandidateDossier} dossier - Candidate facts.
   * @returns {object} Minimal detached candidate projection.
   */
  projectCandidate(dossier) {
    const kinds = ApplicationBriefConstants.EVIDENCE_KIND;
    return {
      experiences: dossier.experiences.map((item) => {
        return this.projectCandidateItem(kinds.EXPERIENCE, item);
      }),
      projects: dossier.projects.map((item) => {
        return this.projectCandidateItem(kinds.PROJECT, item);
      }),
      skills: dossier.skills.map((item) => {
        return this.projectCandidateItem(kinds.SKILL, item);
      }),
      education: dossier.education.map((item) => {
        return this.projectCandidateItem(kinds.EDUCATION, item);
      }),
      languages: dossier.languages.map((item) => {
        return this.projectCandidateItem(kinds.LANGUAGE, item);
      }),
      softSkills: dossier.softSkills.map((item) => {
        return this.projectCandidateItem(kinds.SOFT_SKILL, item);
      }),
    };
  }

  /**
   * Replace one collection-local ID with an explicit evidence kind and stable item ID.
   * @param {string} kind - Evidence kind.
   * @param {object} item - Candidate domain item.
   * @returns {object} Detached projected item.
   */
  projectCandidateItem(kind, item) {
    const { id, ...facts } = structuredClone(item);
    const usableFacts = Object.fromEntries(Object.entries(facts).filter(([, value]) => {
      return value !== null;
    }));
    return { kind, itemId: id, ...usableFacts };
  }
}

export { ApplicationBriefInputProjector };
