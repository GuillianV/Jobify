import { JobSource } from "../constants/JobSource.js";

const ALTERNATE_KEY_SEPARATOR = "|";

/**
 * Selects and assembles one representative without imposing provider ranking.
 */
class OfferRepresentativeSelector {
  /**
   * Create the selector with the shared Careerjet eligibility policy.
   * @param {import("./OfferRepresentativePolicy.js").getEligibleRepresentatives} getEligibleRepresentatives - Eligibility policy.
   */
  constructor(getEligibleRepresentatives) {
    this.getEligibleRepresentatives = getEligibleRepresentatives;
  }

  /**
   * Choose the richest eligible observation from original component indices.
   * @param {import("../models/JobOffer.js").JobOffer[]} offers - Full offer list.
   * @param {number[]} indices - Component indices.
   * @returns {number} Canonical original index.
   */
  pickCanonicalIndex(offers, indices) {
    const indexByOffer = new Map(indices.map((index) => {
      return [offers[index], index];
    }));
    const candidates = indices.map((index) => {
      return offers[index];
    });
    const eligible = this.getEligibleRepresentatives(candidates);
    let bestIndex = indexByOffer.get(eligible[0]);
    for (const candidate of eligible) {
      const index = indexByOffer.get(candidate);
      if (this.isRicher(offers[index], offers[bestIndex])) {
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  /**
   * Merge one complete component into its selected representative.
   * @param {import("../models/JobOffer.js").JobOffer[]} offers - Full offer list.
   * @param {number[]} indices - Component indices.
   * @returns {number} Canonical original index.
   */
  mergeComponent(offers, indices) {
    const canonicalIndex = this.pickCanonicalIndex(offers, indices);
    const canonical = offers[canonicalIndex];
    const known = new Set(canonical.alternates.map((alternate) => {
      return this.buildAlternateKey(alternate);
    }));
    known.add(this.buildAlternateKey(canonical));
    for (const index of indices) {
      if (index === canonicalIndex) {
        continue;
      }
      const duplicate = offers[index];
      this.appendAlternate(canonical, duplicate, known);
      for (const alternate of duplicate.alternates) {
        this.appendAlternate(canonical, alternate, known);
      }
    }
    return canonicalIndex;
  }

  /**
   * Append one flat alternate only when it is neither self nor already known.
   * @param {import("../models/JobOffer.js").JobOffer} canonical - Representative.
   * @param {object} candidate - Offer or flat alternate.
   * @param {Set<string>} known - Existing alternate identities.
   * @returns {void}
   */
  appendAlternate(canonical, candidate, known) {
    const key = this.buildAlternateKey(candidate);
    if (known.has(key)) {
      return;
    }
    canonical.alternates.push({
      source: candidate.source,
      applyUrl: candidate.applyUrl ?? null,
    });
    known.add(key);
  }

  /**
   * Build the historical flat-alternate identity.
   * @param {object} candidate - Offer or alternate.
   * @returns {string} Alternate comparison key.
   */
  buildAlternateKey(candidate) {
    return [candidate.source, candidate.applyUrl ?? ""].join(ALTERNATE_KEY_SEPARATOR);
  }

  /**
   * Tell whether a candidate is richer under the historical rules.
   * @param {import("../models/JobOffer.js").JobOffer} candidate - Candidate.
   * @param {import("../models/JobOffer.js").JobOffer} current - Current best.
   * @returns {boolean} True when candidate should replace current.
   */
  isRicher(candidate, current) {
    const candidateLength = candidate.description ? candidate.description.length : 0;
    const currentLength = current.description ? current.description.length : 0;
    if (candidateLength !== currentLength) {
      return candidateLength > currentLength;
    }
    return candidate.source === JobSource.FRANCE_TRAVAIL
      && current.source !== JobSource.FRANCE_TRAVAIL;
  }
}

export { OfferRepresentativeSelector };
