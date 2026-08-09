import { GroqConstants } from "../constants/GroqConstants.js";
import { JobSource } from "../constants/JobSource.js";
import { TextNormalizer } from "../normalization/TextNormalizer.js";

const SYSTEM_PROMPT = [
  "Tu es un moteur de tri et de deduplication d'offres d'emploi.",
  "On te donne le METIER recherche par l'utilisateur, puis une liste",
  "numerotee d'offres (entreprise, lieu, contrat, resume).",
  "Premiere tache, la DEDUPLICATION: regroupe les indices qui designent la",
  "MEME annonce, y compris republiee sur plusieurs sites avec un intitule",
  "legerement different. Fonde-toi surtout sur l'ENTREPRISE et le POSTE.",
  "Un lieu ecrit differemment reste compatible: une ville et son departement",
  "ou sa region designent la meme zone (par exemple 'Annecy' et",
  "'Haute-Savoie'). Ignore les mentions H/F, F/H, (H/F), la casse, la",
  "ponctuation et l'ordre des mots dans les intitules.",
  "Ne regroupe JAMAIS des postes ou des entreprises reellement differents.",
  "En cas de doute, ne regroupe pas.",
  "Seconde tache, la PERTINENCE: pour chaque indice, note de 0 a 100 la",
  "correspondance de l'offre avec le metier recherche. 100 = correspond",
  "parfaitement, 0 = totalement hors sujet. Penalise fortement un ecart de",
  "technologie ou de fonction par rapport au metier recherche.",
  "Reponds uniquement en JSON avec la forme exacte:",
  '{"doublons": [[i, j], ...], "pertinence": {"0": 90, "1": 20, ...}}.',
].join(" ");

/**
 * Refines the aggregated offers through a single Groq chat completion that
 * both deduplicates them (clustering the same posting across sources) and
 * scores their relevance to the searched job. The service degrades gracefully:
 * without an API key or on failure, the offers are returned untouched.
 */
class SemanticRefiner {
  /**
   * Create the refiner from its Groq credentials and model.
   * @param {object} config - Groq configuration.
   * @param {string} config.apiKey - Groq API key.
   * @param {string} config.model - Groq model identifier.
   * @param {import("./OfferRepresentativePolicy.js").getEligibleRepresentatives} getEligibleRepresentatives - Representative eligibility policy.
   */
  constructor(config, getEligibleRepresentatives) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.getEligibleRepresentatives = getEligibleRepresentatives;
  }

  /**
   * Tell whether the Groq API key is present.
   * @returns {boolean} True when the service can call Groq.
   */
  isConfigured() {
    return Boolean(this.apiKey);
  }

  /**
   * Deduplicate the offers and drop those irrelevant to the searched job,
   * keeping one canonical offer per cluster with its alternate sources.
   * @param {import("../models/JobOffer.js").JobOffer[]} offers - Offers to refine.
   * @param {import("../models/SearchCriteria.js").SearchCriteria} criteria - Search criteria.
   * @returns {Promise<import("../models/JobOffer.js").JobOffer[]>} The refined offers.
   */
  async refine(offers, criteria) {
    if (!this.isConfigured() || offers.length < GroqConstants.MIN_OFFERS_TO_COMPARE) {
      return offers;
    }
    try {
      const analysis = await this.requestAnalysis(offers, criteria);
      const indexByOffer = new Map(offers.map((offer, index) => {
        return [offer, index];
      }));
      const merged = this.collapse(offers, analysis.groups);
      return this.filterByRelevance(indexByOffer, merged, analysis.scores);
    } catch (error) {
      console.warn(`Semantic refinement skipped: ${error.message}`);
      return offers;
    }
  }

  /**
   * Call Groq and return the duplicate groups and relevance scores.
   * @param {import("../models/JobOffer.js").JobOffer[]} offers - Offers to analyze.
   * @param {import("../models/SearchCriteria.js").SearchCriteria} criteria - Search criteria.
   * @returns {Promise<{groups: Array<number[]>, scores: Map<number, number>}>} The analysis.
   */
  async requestAnalysis(offers, criteria) {
    const body = {
      model: this.model,
      temperature: GroqConstants.TEMPERATURE,
      max_tokens: GroqConstants.MAX_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: this.buildUserPrompt(offers, criteria) },
      ],
    };
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, GroqConstants.REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(GroqConstants.CHAT_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Groq HTTP ${response.status}: ${detail}`);
      }
      const payload = await response.json();
      return this.parseAnalysis(payload);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Build the prompt: the searched job followed by the numbered offer listing.
   * @param {import("../models/JobOffer.js").JobOffer[]} offers - Offers to list.
   * @param {import("../models/SearchCriteria.js").SearchCriteria} criteria - Search criteria.
   * @returns {string} The user prompt.
   */
  buildUserPrompt(offers, criteria) {
    const lines = offers.map((offer, index) => {
      const company = offer.company?.name ?? "?";
      const place = this.formatPlace(offer.location);
      const snippet = this.buildSnippet(offer.description);
      const header = `${index}. [${offer.source}] ${offer.title}`;
      const meta = `   entreprise: ${company} | lieu: ${place} | contrat: ${offer.contractType}`;
      const body = `   resume: ${snippet}`;
      return `${header}\n${meta}\n${body}`;
    });
    return `Metier recherche: ${criteria.keywords}\n\nOffres:\n${lines.join("\n")}`;
  }

  /**
   * Format an offer location as "city (postalCode)", falling back gracefully
   * when either part is missing.
   * @param {import("../models/JobLocation.js").JobLocation} location - The location.
   * @returns {string} The formatted place.
   */
  formatPlace(location) {
    const city = location?.city ?? location?.label ?? "?";
    const postalCode = location?.postalCode;
    if (postalCode) {
      return `${city} (${postalCode})`;
    }
    return city;
  }

  /**
   * Build a short, single-line description snippet used as a dedup and
   * relevance signal without inflating the prompt.
   * @param {string|null} description - The offer description.
   * @returns {string} The snippet.
   */
  buildSnippet(description) {
    const collapsed = TextNormalizer.collapseWhitespace(description);
    if (collapsed.length <= GroqConstants.DESCRIPTION_SNIPPET_LENGTH) {
      return collapsed;
    }
    return collapsed.slice(0, GroqConstants.DESCRIPTION_SNIPPET_LENGTH);
  }

  /**
   * Extract the duplicate groups and relevance scores from a Groq payload.
   * @param {object} payload - The raw Groq response.
   * @returns {{groups: Array<number[]>, scores: Map<number, number>}} The analysis.
   */
  parseAnalysis(payload) {
    const content = payload?.choices?.[GroqConstants.FIRST_CHOICE_INDEX]?.message?.content;
    if (!content) {
      return { groups: [], scores: new Map() };
    }
    const parsed = JSON.parse(content);
    const rawGroups = parsed.doublons ?? parsed.duplicates ?? [];
    const groups = Array.isArray(rawGroups) ? rawGroups : [];
    return { groups, scores: this.parseScores(parsed.pertinence ?? parsed.relevance) };
  }

  /**
   * Convert the model's relevance object into a Map keyed by offer index.
   * @param {object} rawScores - The relevance object ({ "0": 90, ... }).
   * @returns {Map<number, number>} The scores keyed by index.
   */
  parseScores(rawScores) {
    const scores = new Map();
    if (!rawScores || typeof rawScores !== "object") {
      return scores;
    }
    for (const [key, value] of Object.entries(rawScores)) {
      const index = Number(key);
      const score = Number(value);
      if (Number.isInteger(index) && !Number.isNaN(score)) {
        scores.set(index, score);
      }
    }
    return scores;
  }

  /**
   * Drop offers whose relevance score is below the threshold. Offers without a
   * score are kept, so a missing rating never silently hides a match.
   * @param {Map<import("../models/JobOffer.js").JobOffer, number>} indexByOffer - Offer to original index.
   * @param {import("../models/JobOffer.js").JobOffer[]} merged - The deduplicated offers.
   * @param {Map<number, number>} scores - Relevance scores keyed by original index.
   * @returns {import("../models/JobOffer.js").JobOffer[]} The relevant offers.
   */
  filterByRelevance(indexByOffer, merged, scores) {
    return merged.filter((offer) => {
      const score = scores.get(indexByOffer.get(offer));
      if (score === undefined) {
        return true;
      }
      return score >= GroqConstants.MIN_RELEVANCE_SCORE;
    });
  }

  /**
   * Collapse clusters into canonical offers, dropping the merged duplicates and
   * attaching their sources to the canonical offer.
   * @param {import("../models/JobOffer.js").JobOffer[]} offers - The full offer list.
   * @param {Array<number[]>} groups - The duplicate index groups.
   * @returns {import("../models/JobOffer.js").JobOffer[]} The merged offers.
   */
  collapse(offers, groups) {
    const used = new Set();
    const mergedAway = new Set();
    for (const group of groups) {
      const indices = this.sanitizeGroup(group, offers.length, used);
      if (indices.length < GroqConstants.MIN_OFFERS_TO_COMPARE) {
        continue;
      }
      const canonicalIndex = this.pickCanonicalIndex(offers, indices);
      for (const index of indices) {
        used.add(index);
        if (index !== canonicalIndex) {
          offers[canonicalIndex].addAlternate(offers[index]);
          mergedAway.add(index);
        }
      }
    }
    return offers.filter((offer, index) => {
      return !mergedAway.has(index);
    });
  }

  /**
   * Keep only valid, in-range, not-yet-used, non-repeated indices in a group.
   * @param {number[]} group - The raw index group from the model.
   * @param {number} length - The number of offers.
   * @param {Set<number>} used - Indices already assigned to a cluster.
   * @returns {number[]} The sanitized indices.
   */
  sanitizeGroup(group, length, used) {
    if (!Array.isArray(group)) {
      return [];
    }
    const seen = new Set();
    const result = [];
    for (const value of group) {
      if (!Number.isInteger(value)) {
        continue;
      }
      if (value < 0 || value >= length) {
        continue;
      }
      if (used.has(value) || seen.has(value)) {
        continue;
      }
      seen.add(value);
      result.push(value);
    }
    return result;
  }

  /**
   * Choose the richest offer of a cluster as the canonical one: the longest
   * description wins, France Travail breaking ties for its fuller content.
   * @param {import("../models/JobOffer.js").JobOffer[]} offers - The full offer list.
   * @param {number[]} indices - The cluster indices.
   * @returns {number} The canonical index.
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
   * Tell whether a candidate offer carries richer content than the current best.
   * @param {import("../models/JobOffer.js").JobOffer} candidate - Candidate offer.
   * @param {import("../models/JobOffer.js").JobOffer} current - Current best offer.
   * @returns {boolean} True when the candidate should replace the current best.
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

export { SemanticRefiner };
