import { createHash } from "node:crypto";
import { DeduplicationConstants } from "../constants/DeduplicationConstants.js";
import { GroqConstants } from "../constants/GroqConstants.js";
import { TextNormalizer } from "../normalization/TextNormalizer.js";

/**
 * Builds the canonical ordered Groq input and its exact persistent cache key.
 */
class SemanticInputProjector {
  /**
   * Create the projector from the exact prompt formatting policies.
   * @param {string} systemPrompt - Exact semantic system prompt.
   * @param {string} [policyVersion] - Semantic validation policy version.
   * @param {number} [snippetLength] - Exact prompt snippet length.
   */
  constructor(
    systemPrompt,
    policyVersion = DeduplicationConstants.SEMANTIC_POLICY_VERSION,
    snippetLength = GroqConstants.DESCRIPTION_SNIPPET_LENGTH,
  ) {
    this.systemPrompt = systemPrompt;
    this.policyVersion = policyVersion;
    this.snippetLength = snippetLength;
  }

  /**
   * Canonically order offers and hash the exact semantic projection.
   * @param {import("../models/JobOffer.js").JobOffer[]} offers - Semantic candidates.
   * @param {import("../models/SearchCriteria.js").SearchCriteria} criteria - Criteria.
   * @param {string} model - Groq model.
   * @returns {{cacheKey: string, orderedOffers: object[], originalIndices: number[], signature: object}} Semantic input.
   */
  build(offers, criteria, model) {
    const entries = offers.map((offer, originalIndex) => {
      const projection = this.projectOffer(offer);
      return {
        offer,
        originalIndex,
        projection,
        orderKey: JSON.stringify(projection),
      };
    });
    entries.sort((first, second) => {
      const projectionOrder = first.orderKey.localeCompare(second.orderKey);
      if (projectionOrder !== 0) {
        return projectionOrder;
      }
      return this.buildTieBreaker(first.offer).localeCompare(this.buildTieBreaker(second.offer));
    });
    const signature = {
      policyVersion: this.policyVersion,
      model,
      systemPromptHash: this.hash(this.systemPrompt),
      snippetLength: this.snippetLength,
      keywords: criteria.keywords,
      offers: entries.map((entry) => {
        return entry.projection;
      }),
    };
    return {
      cacheKey: this.hash(JSON.stringify(signature)),
      orderedOffers: entries.map((entry) => {
        return entry.offer;
      }),
      originalIndices: entries.map((entry) => {
        return entry.originalIndex;
      }),
      signature,
    };
  }

  /**
   * Project exactly the fields used by the semantic user prompt.
   * @param {import("../models/JobOffer.js").JobOffer} offer - Offer.
   * @returns {object} Exact bounded prompt projection.
   */
  projectOffer(offer) {
    return {
      source: offer.source,
      title: offer.title,
      company: offer.company?.name ?? "?",
      place: this.formatPlace(offer.location),
      contractType: String(offer.contractType),
      snippet: this.buildSnippet(offer.description),
    };
  }

  /**
   * Format a location exactly like the semantic user prompt.
   * @param {import("../models/JobLocation.js").JobLocation} location - Location.
   * @returns {string} Prompt place.
   */
  formatPlace(location) {
    const city = location?.city ?? location?.label ?? "?";
    const postalCode = location?.postalCode;
    return postalCode ? `${city} (${postalCode})` : city;
  }

  /**
   * Build the exact bounded semantic description snippet.
   * @param {string|null} description - Automatic description.
   * @returns {string} Prompt snippet.
   */
  buildSnippet(description) {
    const collapsed = TextNormalizer.collapseWhitespace(description);
    return collapsed.length <= this.snippetLength
      ? collapsed
      : collapsed.slice(0, this.snippetLength);
  }

  /**
   * Build a stable non-prompt tie breaker for identical projections.
   * @param {import("../models/JobOffer.js").JobOffer} offer - Offer.
   * @returns {string} Stable ordering value.
   */
  buildTieBreaker(offer) {
    return [offer.id ?? "", offer.sourceId ?? "", offer.surrogateKey ?? ""].join("|");
  }

  /**
   * Hash one cache-key input with SHA-256.
   * @param {string} value - Value to hash.
   * @returns {string} Hex digest.
   */
  hash(value) {
    return createHash("sha256").update(value).digest("hex");
  }
}

export { SemanticInputProjector };
