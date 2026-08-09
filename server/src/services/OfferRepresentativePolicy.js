import { JobSource } from "../constants/JobSource.js";

/**
 * Exclude Careerjet when another provider can represent the ordered group.
 * @param {import("../models/JobOffer.js").JobOffer[]} candidates - Ordered group candidates.
 * @returns {import("../models/JobOffer.js").JobOffer[]} Eligible candidates in original order.
 */
function getEligibleRepresentatives(candidates) {
  const nonCareerjet = candidates.filter((candidate) => {
    return candidate.source !== JobSource.CAREERJET;
  });
  return nonCareerjet.length > 0 ? nonCareerjet : candidates;
}

export { getEligibleRepresentatives };
