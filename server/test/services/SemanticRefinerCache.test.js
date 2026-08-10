import test from "node:test";
import assert from "node:assert/strict";
import { SemanticRefiner, SYSTEM_PROMPT } from "../../src/services/SemanticRefiner.js";
import { SemanticInputProjector } from "../../src/services/SemanticInputProjector.js";
import { OfferRepresentativeSelector } from "../../src/services/OfferRepresentativeSelector.js";
import { StrongDescriptionContainment } from "../../src/services/StrongDescriptionContainment.js";
import { OfferTitleNormalizer } from "../../src/normalization/OfferTitleNormalizer.js";
import { getEligibleRepresentatives } from "../../src/services/OfferRepresentativePolicy.js";
import { JobOffer } from "../../src/models/JobOffer.js";
import { Company } from "../../src/models/Company.js";
import { JobLocation } from "../../src/models/JobLocation.js";
import { Salary } from "../../src/models/Salary.js";
import { JobSource } from "../../src/constants/JobSource.js";

const COMPLETE_SCORE = 80;
const TWO_OFFERS = 2;

/**
 * Minimal persistent cache double with first-writer semantics.
 */
class CacheRepositoryDouble {
  /**
   * Create an empty observable cache.
   */
  constructor() {
    this.entries = new Map();
    this.insertCount = 0;
    this.collisionDecision = null;
  }

  /**
   * Find one decision.
   * @param {string} key - Cache key.
   * @returns {object|null} Cached decision.
   */
  find(key) {
    return this.entries.get(key) ?? null;
  }

  /**
   * Store only the first decision, optionally simulating a concurrent winner.
   * @param {string} key - Cache key.
   * @param {string} policyVersion - Policy version.
   * @param {object} decision - Proposed decision.
   * @returns {void}
   */
  insertOrIgnore(key, policyVersion, decision) {
    this.insertCount += 1;
    if (!this.entries.has(key)) {
      this.entries.set(key, this.collisionDecision ?? decision);
    }
  }
}

/**
 * Build one semantic offer.
 * @param {object} values - Overrides.
 * @returns {JobOffer} Offer.
 */
function createOffer(values = {}) {
  return new JobOffer({
    source: values.source ?? JobSource.ADZUNA,
    sourceId: values.sourceId ?? "adzuna-id",
    title: values.title ?? "Développeur Node H/F",
    description: values.description ?? "Description",
    company: new Company({ name: values.company ?? "Example" }),
    location: new JobLocation({ city: values.city ?? "Annecy" }),
    contractType: "CDI",
    salary: new Salary({}),
    applyUrl: `https://example.com/${values.sourceId ?? "offer"}`,
  });
}

/**
 * Build a fresh equivalent semantic input.
 * @returns {JobOffer[]} Two offers.
 */
function createOffers() {
  return [
    createOffer({ source: JobSource.ADZUNA, sourceId: "adzuna" }),
    createOffer({ source: JobSource.HELLOWORK, sourceId: "hellowork" }),
  ];
}

/**
 * Create a cache-enabled configured refiner.
 * @param {CacheRepositoryDouble} cacheRepository - Cache repository.
 * @param {string} [model] - Model.
 * @param {string} [systemPrompt] - Prompt.
 * @returns {SemanticRefiner} Refiner.
 */
function createRefiner(cacheRepository, model = "model", systemPrompt = SYSTEM_PROMPT) {
  return new SemanticRefiner(
    { apiKey: "test-key", model },
    new OfferRepresentativeSelector(getEligibleRepresentatives),
    new OfferTitleNormalizer(),
    new StrongDescriptionContainment(),
    new SemanticInputProjector(systemPrompt),
    cacheRepository,
  );
}

/**
 * Build one complete offline analysis.
 * @param {Array<number[]>} groups - Proposed groups.
 * @returns {object} Complete analysis.
 */
function createCompleteAnalysis(groups) {
  return {
    groups,
    scores: new Map([[0, COMPLETE_SCORE], [1, COMPLETE_SCORE]]),
    diagnosticComplete: true,
  };
}

test("semantic complete miss persists and equivalent input hits without another request", async () => {
  const cache = new CacheRepositoryDouble();
  const refiner = createRefiner(cache);
  let requestCount = 0;
  refiner.requestAnalysis = async () => {
    requestCount += 1;
    return createCompleteAnalysis([[0, 1]]);
  };

  const first = await refiner.refine(createOffers(), { keywords: "Node" });
  const second = await refiner.refine(createOffers(), { keywords: "Node" });

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(requestCount, 1);
  assert.equal(cache.insertCount, 1);
});

test("semantic persistent cache is reused by a new refiner instance", async () => {
  const cache = new CacheRepositoryDouble();
  const first = createRefiner(cache);
  first.requestAnalysis = async () => {
    return createCompleteAnalysis([[0, 1]]);
  };
  await first.refine(createOffers(), { keywords: "Node" });
  const second = createRefiner(cache);
  second.requestAnalysis = async () => {
    throw new Error("cache hit should not request");
  };

  assert.equal((await second.refine(createOffers(), { keywords: "Node" })).length, 1);
});

test("semantic input keyword model and prompt changes produce cache misses", async () => {
  const cache = new CacheRepositoryDouble();
  let requestCount = 0;
  for (const [model, prompt, keywords] of [
    ["model", SYSTEM_PROMPT, "Node"],
    ["model", SYSTEM_PROMPT, "Java"],
    ["other-model", SYSTEM_PROMPT, "Node"],
    ["model", `${SYSTEM_PROMPT} changed`, "Node"],
  ]) {
    const refiner = createRefiner(cache, model, prompt);
    refiner.requestAnalysis = async () => {
      requestCount += 1;
      return createCompleteAnalysis([]);
    };
    await refiner.refine(createOffers(), { keywords });
  }

  assert.equal(requestCount, cache.entries.size);
});

test("complete zero-component decision is cached while partial is not", async () => {
  const completeCache = new CacheRepositoryDouble();
  const complete = createRefiner(completeCache);
  complete.requestAnalysis = async () => {
    return createCompleteAnalysis([]);
  };
  await complete.refine(createOffers(), { keywords: "Node" });

  const partialCache = new CacheRepositoryDouble();
  const partial = createRefiner(partialCache);
  partial.requestAnalysis = async () => {
    return { groups: [], scores: new Map(), diagnosticComplete: false };
  };
  await partial.refine(createOffers(), { keywords: "Node" });

  assert.equal(completeCache.entries.size, 1);
  assert.equal(partialCache.entries.size, 0);
});

test("semantic failures never enter the cache", async () => {
  for (const failure of [
    new Error("timeout"),
    new Error("Groq HTTP 429"),
    new TypeError("network"),
    new SyntaxError("parsing"),
  ]) {
    const cache = new CacheRepositoryDouble();
    const refiner = createRefiner(cache);
    refiner.requestAnalysis = async () => {
      throw failure;
    };

    assert.equal((await refiner.refine(createOffers(), { keywords: "Node" })).length, TWO_OFFERS);
    assert.equal(cache.entries.size, 0);
  }
});

test("invalid cache is ignored and replaced only when persistence permits", async () => {
  const cache = new CacheRepositoryDouble();
  const refiner = createRefiner(cache);
  const input = refiner.inputProjector.build(createOffers(), { keywords: "Node" }, refiner.model);
  cache.entries.set(input.cacheKey, { inputCount: TWO_OFFERS, components: [[0, 0]] });
  let requestCount = 0;
  refiner.requestAnalysis = async () => {
    requestCount += 1;
    return createCompleteAnalysis([]);
  };

  const result = await refiner.refine(createOffers(), { keywords: "Node" });

  assert.equal(result.length, TWO_OFFERS);
  assert.equal(requestCount, 1);
});

test("single-flight performs one request for concurrent identical misses", async () => {
  const cache = new CacheRepositoryDouble();
  const refiner = createRefiner(cache);
  let requestCount = 0;
  let release;
  refiner.requestAnalysis = async () => {
    requestCount += 1;
    await new Promise((resolve) => {
      release = resolve;
    });
    return createCompleteAnalysis([[0, 1]]);
  };

  const first = refiner.refine(createOffers(), { keywords: "Node" });
  const second = refiner.refine(createOffers(), { keywords: "Node" });
  await Promise.resolve();
  release();
  const results = await Promise.all([first, second]);

  assert.equal(requestCount, 1);
  assert.deepEqual(results.map((offers) => {
    return offers.length;
  }), [1, 1]);
});

test("concurrent persistent winner is reread as authoritative decision", async () => {
  const cache = new CacheRepositoryDouble();
  cache.collisionDecision = { inputCount: TWO_OFFERS, components: [] };
  const refiner = createRefiner(cache);
  refiner.requestAnalysis = async () => {
    return createCompleteAnalysis([[0, 1]]);
  };

  const result = await refiner.refine(createOffers(), { keywords: "Node" });

  assert.equal(result.length, TWO_OFFERS);
});

test("semantic guard accepts only cross-provider objective corroborations", () => {
  const refiner = createRefiner(new CacheRepositoryDouble());
  const adzuna = createOffer({ source: JobSource.ADZUNA, sourceId: "adzuna" });
  const helloWork = createOffer({ source: JobSource.HELLOWORK, sourceId: "hellowork" });
  const sameProvider = createOffer({ source: JobSource.ADZUNA, sourceId: "adzuna-second" });
  const otherCompany = createOffer({
    source: JobSource.HELLOWORK,
    sourceId: "other-company",
    company: "Other",
  });
  const otherCity = createOffer({
    source: JobSource.HELLOWORK,
    sourceId: "other-city",
    city: "Lyon",
  });

  assert.equal(refiner.isSemanticRelationSafe(adzuna, helloWork), true);
  assert.equal(refiner.isSemanticRelationSafe(adzuna, sameProvider), false);
  assert.equal(refiner.isSemanticRelationSafe(adzuna, otherCompany), false);
  assert.equal(refiner.isSemanticRelationSafe(adzuna, otherCity), false);
});
