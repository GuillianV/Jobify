import { TextNormalizer } from "../normalization/TextNormalizer.js";

/**
 * Collapses only obvious cross-provider duplicates through deterministic evidence.
 */
class DeterministicOfferDeduplicator {
  /**
   * Create the deduplicator from its normalization and selection policies.
   * @param {import("../normalization/OfferTitleNormalizer.js").OfferTitleNormalizer} titleNormalizer - Title policy.
   * @param {import("./StrongDescriptionContainment.js").StrongDescriptionContainment} descriptionContainment - Description policy.
   * @param {import("./OfferRepresentativeSelector.js").OfferRepresentativeSelector} representativeSelector - Representative selector.
   */
  constructor(titleNormalizer, descriptionContainment, representativeSelector) {
    this.titleNormalizer = titleNormalizer;
    this.descriptionContainment = descriptionContainment;
    this.representativeSelector = representativeSelector;
  }

  /**
   * Collapse deterministic connected components while preserving output order.
   * @param {import("../models/JobOffer.js").JobOffer[]} offers - Exact-deduped offers.
   * @returns {import("../models/JobOffer.js").JobOffer[]} Obvious-deduped offers.
   */
  deduplicate(offers) {
    const parents = offers.map((offer, index) => {
      return index;
    });
    for (let firstIndex = 0; firstIndex < offers.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < offers.length; secondIndex += 1) {
        if (this.isObviousRelation(offers[firstIndex], offers[secondIndex])) {
          this.union(parents, firstIndex, secondIndex);
        }
      }
    }
    return this.collapse(offers, this.buildComponents(parents));
  }

  /**
   * Validate one conservative obvious duplicate relation.
   * @param {import("../models/JobOffer.js").JobOffer} first - First offer.
   * @param {import("../models/JobOffer.js").JobOffer} second - Second offer.
   * @returns {boolean} True when deterministic evidence is sufficient.
   */
  isObviousRelation(first, second) {
    if (first.source === second.source) {
      return false;
    }
    const firstCompany = TextNormalizer.slug(first.company?.name);
    const secondCompany = TextNormalizer.slug(second.company?.name);
    if (!firstCompany || firstCompany !== secondCompany) {
      return false;
    }
    const firstTitle = this.titleNormalizer.canonicalize(first.title, first.company?.name);
    const secondTitle = this.titleNormalizer.canonicalize(second.title, second.company?.name);
    if (!firstTitle || firstTitle !== secondTitle) {
      return false;
    }
    const firstCity = TextNormalizer.slug(first.location?.city);
    const secondCity = TextNormalizer.slug(second.location?.city);
    if (firstCity && firstCity === secondCity) {
      return true;
    }
    return this.descriptionContainment.matches(first.description, second.description);
  }

  /**
   * Collapse components with the shared representative and alternate policy.
   * @param {import("../models/JobOffer.js").JobOffer[]} offers - Full offer list.
   * @param {Array<number[]>} components - Connected components.
   * @returns {import("../models/JobOffer.js").JobOffer[]} Collapsed offers.
   */
  collapse(offers, components) {
    const mergedAway = new Set();
    for (const component of components) {
      const canonicalIndex = this.representativeSelector.mergeComponent(offers, component);
      for (const index of component) {
        if (index !== canonicalIndex) {
          mergedAway.add(index);
        }
      }
    }
    return offers.filter((offer, index) => {
      return !mergedAway.has(index);
    });
  }

  /**
   * Unite two graph indices under the lowest root.
   * @param {number[]} parents - Union-find parents.
   * @param {number} firstIndex - First index.
   * @param {number} secondIndex - Second index.
   * @returns {void}
   */
  union(parents, firstIndex, secondIndex) {
    const firstRoot = this.findRoot(parents, firstIndex);
    const secondRoot = this.findRoot(parents, secondIndex);
    if (firstRoot === secondRoot) {
      return;
    }
    parents[Math.max(firstRoot, secondRoot)] = Math.min(firstRoot, secondRoot);
  }

  /**
   * Find and compress one graph root.
   * @param {number[]} parents - Union-find parents.
   * @param {number} index - Graph index.
   * @returns {number} Root index.
   */
  findRoot(parents, index) {
    let root = index;
    while (parents[root] !== root) {
      root = parents[root];
    }
    let current = index;
    while (parents[current] !== current) {
      const parent = parents[current];
      parents[current] = root;
      current = parent;
    }
    return root;
  }

  /**
   * Build multi-offer components in original order.
   * @param {number[]} parents - Union-find parents.
   * @returns {Array<number[]>} Connected components.
   */
  buildComponents(parents) {
    const byRoot = new Map();
    for (let index = 0; index < parents.length; index += 1) {
      const root = this.findRoot(parents, index);
      if (!byRoot.has(root)) {
        byRoot.set(root, []);
      }
      byRoot.get(root).push(index);
    }
    return [...byRoot.values()].filter((component) => {
      return component.length > 1;
    });
  }
}

export { DeterministicOfferDeduplicator };
