import { GroqConstants } from "../constants/GroqConstants.js";
import { TextNormalizer } from "../normalization/TextNormalizer.js";
import { DeduplicationConstants } from "../constants/DeduplicationConstants.js";

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
   * @param {import("./OfferRepresentativeSelector.js").OfferRepresentativeSelector} representativeSelector - Representative selector.
   * @param {import("../normalization/OfferTitleNormalizer.js").OfferTitleNormalizer} titleNormalizer - Canonical title policy.
   * @param {import("./StrongDescriptionContainment.js").StrongDescriptionContainment} descriptionContainment - Description policy.
   * @param {import("./SemanticInputProjector.js").SemanticInputProjector|null} inputProjector - Cache input projector.
   * @param {import("../persistence/SemanticDedupCacheRepository.js").SemanticDedupCacheRepository|null} cacheRepository - Persistent cache.
   */
  constructor(
    config,
    representativeSelector,
    titleNormalizer,
    descriptionContainment,
    inputProjector = null,
    cacheRepository = null,
  ) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.representativeSelector = representativeSelector;
    this.titleNormalizer = titleNormalizer;
    this.descriptionContainment = descriptionContainment;
    this.inputProjector = inputProjector;
    this.systemPrompt = inputProjector?.systemPrompt ?? SYSTEM_PROMPT;
    this.cacheRepository = cacheRepository;
    this.inFlight = new Map();
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
      const semanticInput = this.inputProjector
        ? this.inputProjector.build(offers, criteria, this.model)
        : {
          cacheKey: null,
          orderedOffers: offers,
          originalIndices: offers.map((offer, index) => {
            return index;
          }),
        };
      const resolved = await this.resolveDecision(semanticInput, criteria);
      const originalComponents = this.mapComponents(
        resolved.components,
        semanticInput.originalIndices,
      );
      const refined = this.collapseComponents(offers, originalComponents);
      return refined;
    } catch (error) {
      console.warn(`Semantic refinement skipped: ${error.message}`);
      return offers;
    }
  }

  /**
   * Resolve a validated semantic decision from cache or one single-flight request.
   * @param {object} semanticInput - Canonically ordered semantic input.
   * @param {import("../models/SearchCriteria.js").SearchCriteria} criteria - Criteria.
   * @returns {Promise<{components: Array<number[]>}>} Decision.
   */
  async resolveDecision(semanticInput, criteria) {
    const cached = this.readValidCache(semanticInput);
    if (cached) {
      return { components: cached.components };
    }
    if (!semanticInput.cacheKey || !this.cacheRepository) {
      const analysis = await this.requestAnalysis(semanticInput.orderedOffers, criteria);
      return {
        components: this.buildValidatedComponents(semanticInput.orderedOffers, analysis.groups),
      };
    }
    if (this.inFlight.has(semanticInput.cacheKey)) {
      return this.inFlight.get(semanticInput.cacheKey);
    }
    const request = this.requestAndPersistDecision(semanticInput, criteria);
    this.inFlight.set(semanticInput.cacheKey, request);
    try {
      return await request;
    } finally {
      this.inFlight.delete(semanticInput.cacheKey);
    }
  }

  /**
   * Request, validate and conditionally persist one semantic decision.
   * @param {object} semanticInput - Canonical semantic input.
   * @param {import("../models/SearchCriteria.js").SearchCriteria} criteria - Criteria.
   * @returns {Promise<{components: Array<number[]>}>} Decision.
   */
  async requestAndPersistDecision(semanticInput, criteria) {
    const analysis = await this.requestAnalysis(semanticInput.orderedOffers, criteria);
    const components = this.buildValidatedComponents(
      semanticInput.orderedOffers,
      analysis.groups,
    );
    const isComplete = analysis.diagnosticComplete
      && this.hasCompleteScores(analysis.scores, semanticInput.orderedOffers.length);
    if (!isComplete) {
      return { components };
    }
    const decision = {
      inputCount: semanticInput.orderedOffers.length,
      components,
    };
    this.cacheRepository.insertOrIgnore(
      semanticInput.cacheKey,
      DeduplicationConstants.SEMANTIC_POLICY_VERSION,
      decision,
    );
    const authoritative = this.readValidCache(semanticInput);
    return {
      components: authoritative?.components ?? components,
    };
  }

  /**
   * Read and defensively validate one cached decision.
   * @param {object} semanticInput - Canonical semantic input.
   * @returns {object|null} Valid decision or null.
   */
  readValidCache(semanticInput) {
    if (!semanticInput.cacheKey || !this.cacheRepository) {
      return null;
    }
    const decision = this.cacheRepository.find(semanticInput.cacheKey);
    if (!this.isValidDecisionStructure(decision, semanticInput.orderedOffers.length)) {
      return null;
    }
    const revalidated = this.buildValidatedComponents(
      semanticInput.orderedOffers,
      decision.components,
    );
    return JSON.stringify(revalidated) === JSON.stringify(decision.components)
      ? decision
      : null;
  }

  /**
   * Validate cached component shape, bounds and global index uniqueness.
   * @param {object|null} decision - Cached decision.
   * @param {number} inputCount - Current semantic input count.
   * @returns {boolean} True when structurally safe.
   */
  isValidDecisionStructure(decision, inputCount) {
    if (!decision || decision.inputCount !== inputCount || !Array.isArray(decision.components)) {
      return false;
    }
    const seen = new Set();
    for (const component of decision.components) {
      if (!Array.isArray(component) || component.length < GroqConstants.MIN_OFFERS_TO_COMPARE) {
        return false;
      }
      for (const index of component) {
        if (!Number.isInteger(index) || index < 0 || index >= inputCount || seen.has(index)) {
          return false;
        }
        seen.add(index);
      }
    }
    return true;
  }

  /**
   * Verify that every semantic input index has exactly one parsed score entry.
   * @param {Map<number, number>} scores - Parsed semantic scores.
   * @param {number} inputCount - Semantic input count.
   * @returns {boolean} True when score coverage is complete and in range.
   */
  hasCompleteScores(scores, inputCount) {
    if (scores.size !== inputCount) {
      return false;
    }
    for (let index = 0; index < inputCount; index += 1) {
      if (!scores.has(index)) {
        return false;
      }
    }
    return true;
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
        { role: "system", content: this.systemPrompt },
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
    if (this.inputProjector) {
      return this.inputProjector.formatPlace(location);
    }
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
    if (this.inputProjector) {
      return this.inputProjector.buildSnippet(description);
    }
    const collapsed = TextNormalizer.collapseWhitespace(description);
    if (collapsed.length <= GroqConstants.DESCRIPTION_SNIPPET_LENGTH) {
      return collapsed;
    }
    return collapsed.slice(0, GroqConstants.DESCRIPTION_SNIPPET_LENGTH);
  }

  /**
   * Extract the duplicate groups and relevance scores from a Groq payload.
   * @param {object} payload - The raw Groq response.
   * @returns {{groups: Array<number[]>, scores: Map<number, number>, diagnosticComplete: boolean}} The analysis.
   */
  parseAnalysis(payload) {
    const content = payload?.choices?.[GroqConstants.FIRST_CHOICE_INDEX]?.message?.content;
    if (!content) {
      return { groups: [], scores: new Map(), diagnosticComplete: false };
    }
    const parsed = JSON.parse(content);
    const rawGroups = parsed.doublons ?? parsed.duplicates ?? [];
    const groups = Array.isArray(rawGroups) ? rawGroups : [];
    const rawScores = parsed.pertinence ?? parsed.relevance;
    const scores = this.parseScores(rawScores);
    const diagnosticComplete = Array.isArray(rawGroups)
      && rawScores !== null
      && typeof rawScores === "object";
    return { groups, scores, diagnosticComplete };
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
   * Collapse guarded connected components into canonical offers, dropping the
   * merged duplicates and attaching their sources to the canonical offer.
   * @param {import("../models/JobOffer.js").JobOffer[]} offers - The full offer list.
   * @param {Array<number[]>} groups - The duplicate index groups.
   * @returns {import("../models/JobOffer.js").JobOffer[]} The merged offers.
   */
  collapse(offers, groups) {
    return this.collapseComponents(offers, this.buildValidatedComponents(offers, groups));
  }

  /**
   * Build guarded semantic connected components without selecting representatives.
   * @param {import("../models/JobOffer.js").JobOffer[]} offers - Semantic offers.
   * @param {Array<number[]>} groups - Proposed groups.
   * @returns {Array<number[]>} Validated components.
   */
  buildValidatedComponents(offers, groups) {
    const parents = offers.map((offer, index) => {
      return index;
    });
    for (const group of groups) {
      const indices = this.sanitizeGroup(group, offers.length);
      this.unionSafeRelations(offers, indices, parents);
    }
    return this.buildComponents(parents);
  }

  /**
   * Collapse validated components with the shared representative policy.
   * @param {import("../models/JobOffer.js").JobOffer[]} offers - Full offer list.
   * @param {Array<number[]>} components - Validated original-index components.
   * @returns {import("../models/JobOffer.js").JobOffer[]} Collapsed offers.
   */
  collapseComponents(offers, components) {
    const mergedAway = new Set();
    for (const indices of components) {
      const canonicalIndex = this.representativeSelector.mergeComponent(offers, indices);
      for (const index of indices) {
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
   * Keep only valid, in-range, non-repeated indices in a group.
   * @param {number[]} group - The raw index group from the model.
   * @param {number} length - The number of offers.
   * @returns {number[]} The sanitized indices.
   */
  sanitizeGroup(group, length) {
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
      if (seen.has(value)) {
        continue;
      }
      seen.add(value);
      result.push(value);
    }
    return result;
  }

  /**
   * Evaluate every pair in one Groq group and unite company-equivalent offers.
   * @param {import("../models/JobOffer.js").JobOffer[]} offers - Full offer list.
   * @param {number[]} indices - Sanitized group indices.
   * @param {number[]} parents - Union-find parent indices.
   * @returns {void}
   */
  unionSafeRelations(offers, indices, parents) {
    for (let firstPosition = 0; firstPosition < indices.length; firstPosition += 1) {
      for (
        let secondPosition = firstPosition + 1;
        secondPosition < indices.length;
        secondPosition += 1
      ) {
        const firstIndex = indices[firstPosition];
        const secondIndex = indices[secondPosition];
        if (this.isSemanticRelationSafe(offers[firstIndex], offers[secondIndex])) {
          this.unionIndices(parents, firstIndex, secondIndex);
        }
      }
    }
  }

  /**
   * Tell whether two offers have the same non-empty normalized company name.
   * @param {import("../models/JobOffer.js").JobOffer} first - First offer.
   * @param {import("../models/JobOffer.js").JobOffer} second - Second offer.
   * @returns {boolean} True when the semantic relation is safe to accept.
   */
  haveEquivalentCompanies(first, second) {
    const firstCompany = TextNormalizer.slug(first.company?.name);
    const secondCompany = TextNormalizer.slug(second.company?.name);
    return Boolean(firstCompany) && firstCompany === secondCompany;
  }

  /**
   * Validate company equality plus one deterministic semantic corroboration.
   * @param {import("../models/JobOffer.js").JobOffer} first - First offer.
   * @param {import("../models/JobOffer.js").JobOffer} second - Second offer.
   * @returns {boolean} True when a Groq relation is safe to accept.
   */
  isSemanticRelationSafe(first, second) {
    if (first.source === second.source) {
      return false;
    }
    if (!this.haveEquivalentCompanies(first, second)) {
      return false;
    }
    const firstTitle = this.titleNormalizer.canonicalize(first.title, first.company?.name);
    const secondTitle = this.titleNormalizer.canonicalize(second.title, second.company?.name);
    if (this.descriptionContainment.matches(first.description, second.description)) {
      return true;
    }
    const firstCity = TextNormalizer.slug(first.location?.city);
    const secondCity = TextNormalizer.slug(second.location?.city);
    return Boolean(firstTitle)
      && firstTitle === secondTitle
      && Boolean(firstCity)
      && firstCity === secondCity;
  }

  /**
   * Map canonical semantic indices back to historical offer indices.
   * @param {Array<number[]>} components - Semantic-order components.
   * @param {number[]} originalIndices - Semantic-to-original mapping.
   * @returns {Array<number[]>} Original-order components.
   */
  mapComponents(components, originalIndices) {
    return components.map((component) => {
      return component.map((index) => {
        return originalIndices[index];
      });
    }).sort((first, second) => {
      return Math.min(...first) - Math.min(...second);
    });
  }

  /**
   * Unite two indices under the lowest root for deterministic components.
   * @param {number[]} parents - Union-find parent indices.
   * @param {number} firstIndex - First offer index.
   * @param {number} secondIndex - Second offer index.
   * @returns {void}
   */
  unionIndices(parents, firstIndex, secondIndex) {
    const firstRoot = this.findRoot(parents, firstIndex);
    const secondRoot = this.findRoot(parents, secondIndex);
    if (firstRoot === secondRoot) {
      return;
    }
    const lowerRoot = Math.min(firstRoot, secondRoot);
    const higherRoot = Math.max(firstRoot, secondRoot);
    parents[higherRoot] = lowerRoot;
  }

  /**
   * Find and compress the root of one union-find index.
   * @param {number[]} parents - Union-find parent indices.
   * @param {number} index - Offer index.
   * @returns {number} Component root.
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
   * Build multi-offer components in original index order.
   * @param {number[]} parents - Union-find parent indices.
   * @returns {Array<number[]>} Deterministically ordered connected components.
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
    const components = [...byRoot.values()].filter((indices) => {
      return indices.length >= GroqConstants.MIN_OFFERS_TO_COMPARE;
    });
    components.sort((first, second) => {
      return first[0] - second[0];
    });
    return components;
  }

  /**
   * Choose the richest offer of a cluster as the canonical one: the longest
   * description wins, France Travail breaking ties for its fuller content.
   * @param {import("../models/JobOffer.js").JobOffer[]} offers - The full offer list.
   * @param {number[]} indices - The cluster indices.
   * @returns {number} The canonical index.
   */
  pickCanonicalIndex(offers, indices) {
    return this.representativeSelector.pickCanonicalIndex(offers, indices);
  }

  /**
   * Tell whether a candidate offer carries richer content than the current best.
   * @param {import("../models/JobOffer.js").JobOffer} candidate - Candidate offer.
   * @param {import("../models/JobOffer.js").JobOffer} current - Current best offer.
   * @returns {boolean} True when the candidate should replace the current best.
   */
  isRicher(candidate, current) {
    return this.representativeSelector.isRicher(candidate, current);
  }
}

export { SemanticRefiner, SYSTEM_PROMPT };
