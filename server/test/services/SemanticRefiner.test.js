import test from "node:test";
import assert from "node:assert/strict";
import { SemanticRefiner } from "../../src/services/SemanticRefiner.js";
import { getEligibleRepresentatives } from "../../src/services/OfferRepresentativePolicy.js";
import { GroqConstants } from "../../src/constants/GroqConstants.js";
import { JobOffer } from "../../src/models/JobOffer.js";
import { Company } from "../../src/models/Company.js";
import { JobLocation } from "../../src/models/JobLocation.js";
import { Salary } from "../../src/models/Salary.js";
import { JobSource } from "../../src/constants/JobSource.js";
import { OfferContent } from "../../src/models/OfferContent.js";
import { OfferContentAcquisition } from "../../src/constants/OfferContentAcquisition.js";
import { OfferContentCompleteness } from "../../src/constants/OfferContentCompleteness.js";
import { OfferRepresentativeSelector } from "../../src/services/OfferRepresentativeSelector.js";
import { OfferTitleNormalizer } from "../../src/normalization/OfferTitleNormalizer.js";
import { StrongDescriptionContainment } from "../../src/services/StrongDescriptionContainment.js";

const LONG_DESCRIPTION_LENGTH = 500;
const SHORT_DESCRIPTION_LENGTH = 20;
const EXCESS_SNIPPET_LENGTH = 40;
const CAREERJET_INDEX = 2;
const ADZUNA_INDEX = 5;
const HELLOWORK_INDEX = 8;
const OFFER_ARRAY_LENGTH = 9;
const TWO_ALTERNATES = 2;
const THIRD_GROUP_INDEX = 2;
const FOUR_OFFERS = 4;
const LOW_RELEVANCE_SCORE = 40;
const HIGH_RELEVANCE_SCORE = 60;
const TENTH_INDEX = 10;
const ELEVENTH_INDEX = 11;
const TWELFTH_INDEX = 12;
const THIRTEENTH_INDEX = 13;
const TWELVE_OFFERS = 12;
const FOURTEEN_OFFERS = 14;
const RETRIEVED_AT = "2026-08-01T10:00:00.000Z";

/**
 * Build an offer for semantic representative tests.
 * @param {string} source - Provider source.
 * @param {number} descriptionLength - Description length.
 * @returns {JobOffer} Test offer.
 */
function createOffer(source, descriptionLength = SHORT_DESCRIPTION_LENGTH) {
  return new JobOffer({
    source,
    sourceId: `${source}-id`,
    title: "Developer",
    description: "x".repeat(descriptionLength),
    company: new Company({ name: "Example" }),
    location: new JobLocation({ city: "Annecy" }),
    salary: new Salary({}),
  });
}

/**
 * Create an offline semantic refiner.
 * @returns {SemanticRefiner} Refiner instance.
 */
function createRefiner() {
  return new SemanticRefiner(
    { apiKey: "", model: "test" },
    new OfferRepresentativeSelector(getEligibleRepresentatives),
    new OfferTitleNormalizer(),
    new StrongDescriptionContainment(),
  );
}

/**
 * Create a configured semantic refiner without performing a real request.
 * @returns {SemanticRefiner} Configured refiner.
 */
function createConfiguredRefiner() {
  return new SemanticRefiner(
    { apiKey: "test-key", model: "test" },
    new OfferRepresentativeSelector(getEligibleRepresentatives),
    new OfferTitleNormalizer(),
    new StrongDescriptionContainment(),
  );
}

/**
 * Build an offer with a specific company and stable test identity.
 * @param {string} source - Provider source.
 * @param {string|null} companyName - Hiring company name.
 * @param {string} identity - Test identity suffix.
 * @param {number} [descriptionLength] - Description length.
 * @returns {JobOffer} Test offer.
 */
function createCompanyOffer(
  source,
  companyName,
  identity,
  descriptionLength = SHORT_DESCRIPTION_LENGTH,
) {
  const offer = createOffer(source, descriptionLength);
  offer.sourceId = identity;
  offer.company = new Company({ name: companyName });
  offer.applyUrl = `https://example.com/${identity}`;
  return offer;
}

/**
 * Refine offers with a deterministic offline Groq analysis.
 * @param {JobOffer[]} offers - Offers to refine.
 * @param {Array<number[]>} groups - Duplicate relations.
 * @param {Map<number, number>} scores - Parsed relevance scores.
 * @returns {Promise<JobOffer[]>} Refined offers.
 */
async function refineWithAnalysis(offers, groups, scores) {
  const refiner = createConfiguredRefiner();
  refiner.requestAnalysis = async () => {
    return { groups, scores, diagnosticComplete: true };
  };
  return refiner.refine(offers, { keywords: "Developer" });
}

/**
 * Build the stable offer set used to compare semantic relevance scores.
 * @returns {JobOffer[]} Equivalent score-test input.
 */
function createScoreTestOffers() {
  return [
    createCompanyOffer(JobSource.ADZUNA, "Ikigai", "adzuna-ikigai"),
    createCompanyOffer(JobSource.HELLOWORK, "Ikigaï", "hellowork-ikigai"),
    createCompanyOffer(JobSource.ADZUNA, "Separate", "adzuna-separate"),
  ];
}

test("semantic canonical selection always excludes Careerjet when an alternative exists", () => {
  const refiner = createRefiner();
  const alternatives = [
    JobSource.FRANCE_TRAVAIL,
    JobSource.ADZUNA,
    JobSource.HELLOWORK,
  ];
  for (const source of alternatives) {
    const careerjet = createOffer(JobSource.CAREERJET, LONG_DESCRIPTION_LENGTH);
    const alternative = createOffer(source, SHORT_DESCRIPTION_LENGTH);

    assert.equal(refiner.pickCanonicalIndex([careerjet, alternative], [0, 1]), 1);
  }
});

test("semantic canonical selection keeps Careerjet when it is the only candidate", () => {
  const refiner = createRefiner();
  const careerjet = createOffer(JobSource.CAREERJET);

  assert.equal(refiner.pickCanonicalIndex([careerjet], [0]), 0);
});

test("semantic canonical selection returns the original non-contiguous index", () => {
  const refiner = createRefiner();
  const offers = Array.from({ length: OFFER_ARRAY_LENGTH }, () => {
    return createOffer(JobSource.ADZUNA, SHORT_DESCRIPTION_LENGTH);
  });
  offers[CAREERJET_INDEX] = createOffer(JobSource.CAREERJET, LONG_DESCRIPTION_LENGTH);
  offers[ADZUNA_INDEX] = createOffer(JobSource.ADZUNA, SHORT_DESCRIPTION_LENGTH);
  offers[HELLOWORK_INDEX] = createOffer(
    JobSource.HELLOWORK,
    LONG_DESCRIPTION_LENGTH - SHORT_DESCRIPTION_LENGTH,
  );

  const canonicalIndex = refiner.pickCanonicalIndex(
    offers,
    [CAREERJET_INDEX, ADZUNA_INDEX, HELLOWORK_INDEX],
  );

  assert.equal(canonicalIndex, HELLOWORK_INDEX);
});

test("semantic canonical selection preserves historical non-Careerjet richness rules", () => {
  const refiner = createRefiner();
  const adzunaShort = createOffer(JobSource.ADZUNA, SHORT_DESCRIPTION_LENGTH);
  const helloWorkLong = createOffer(JobSource.HELLOWORK, LONG_DESCRIPTION_LENGTH);
  const franceTravailTie = createOffer(JobSource.FRANCE_TRAVAIL, LONG_DESCRIPTION_LENGTH);

  assert.equal(refiner.pickCanonicalIndex([adzunaShort, helloWorkLong], [0, 1]), 1);
  assert.equal(refiner.pickCanonicalIndex([helloWorkLong, franceTravailTie], [0, 1]), 1);
});

test("semantic collapse retains rejected Careerjet as an alternate", () => {
  const refiner = createRefiner();
  const careerjet = createOffer(JobSource.CAREERJET, LONG_DESCRIPTION_LENGTH);
  careerjet.applyUrl = "https://example.com/careerjet";
  const adzuna = createOffer(JobSource.ADZUNA, SHORT_DESCRIPTION_LENGTH);

  const result = refiner.collapse([careerjet, adzuna], [[0, 1]]);

  assert.deepEqual(result, [adzuna]);
  assert.deepEqual(adzuna.alternates, [{
    source: JobSource.CAREERJET,
    applyUrl: careerjet.applyUrl,
  }]);
});

test("semantic collapse adds every non-canonical observation as an alternate", () => {
  const refiner = createRefiner();
  const careerjet = createOffer(JobSource.CAREERJET, LONG_DESCRIPTION_LENGTH);
  careerjet.applyUrl = "https://example.com/careerjet";
  const adzuna = createOffer(JobSource.ADZUNA, SHORT_DESCRIPTION_LENGTH);
  adzuna.applyUrl = "https://example.com/adzuna";
  const helloWork = createOffer(JobSource.HELLOWORK, LONG_DESCRIPTION_LENGTH);
  helloWork.applyUrl = "https://example.com/hellowork";

  const result = refiner.collapse(
    [careerjet, adzuna, helloWork],
    [[0, 1, THIRD_GROUP_INDEX]],
  );

  assert.deepEqual(result, [helloWork]);
  assert.equal(helloWork.alternates.length, TWO_ALTERNATES);
  assert.deepEqual(helloWork.alternates, [
    { source: JobSource.CAREERJET, applyUrl: careerjet.applyUrl },
    { source: JobSource.ADZUNA, applyUrl: adzuna.applyUrl },
  ]);
  assert.equal(helloWork.alternates.some((alternate) => {
    return alternate.source === JobSource.HELLOWORK;
  }), false);
  assert.deepEqual(Object.keys(helloWork.alternates[0]).sort(), ["applyUrl", "source"]);
  assert.deepEqual(Object.keys(helloWork.alternates[1]).sort(), ["applyUrl", "source"]);
});

test("semantic relevance scores cannot change final cardinality", async () => {
  const groups = [[0, 1]];
  const highScores = new Map([
    [0, HIGH_RELEVANCE_SCORE],
    [1, HIGH_RELEVANCE_SCORE],
    [THIRD_GROUP_INDEX, HIGH_RELEVANCE_SCORE],
  ]);
  const lowScores = new Map([
    [0, LOW_RELEVANCE_SCORE],
    [1, LOW_RELEVANCE_SCORE],
    [THIRD_GROUP_INDEX, LOW_RELEVANCE_SCORE],
  ]);

  const highResult = await refineWithAnalysis(createScoreTestOffers(), groups, highScores);
  const lowResult = await refineWithAnalysis(createScoreTestOffers(), groups, lowScores);

  assert.equal(highResult.length, TWO_ALTERNATES);
  assert.equal(lowResult.length, highResult.length);
});

test("zero semantic relevance score never removes a non-duplicate offer", async () => {
  const offers = [
    createCompanyOffer(JobSource.ADZUNA, "First", "first"),
    createCompanyOffer(JobSource.HELLOWORK, "Second", "second"),
  ];
  const result = await refineWithAnalysis(offers, [], new Map([
    [0, 0],
    [1, 0],
  ]));

  assert.deepEqual(result, offers);
});

test("overlapping semantic relations form one transitive component without duplicate alternates", () => {
  const refiner = createRefiner();
  const offers = Array.from({ length: TWELVE_OFFERS }, (unused, index) => {
    return createCompanyOffer(JobSource.ADZUNA, `Separate ${index}`, `separate-${index}`);
  });
  offers[0] = createCompanyOffer(
    JobSource.HELLOWORK,
    "Ikigaï",
    "hellowork-ikigai",
    LONG_DESCRIPTION_LENGTH,
  );
  offers[1] = createCompanyOffer(JobSource.ADZUNA, "Ikigai", "adzuna-ikigai");
  offers[ELEVENTH_INDEX] = createCompanyOffer(
    JobSource.CAREERJET,
    "IKIGAI",
    "careerjet-ikigai",
  );

  const result = refiner.collapse(offers, [[0, 1], [0, ELEVENTH_INDEX]]);

  assert.equal(result.length, TENTH_INDEX);
  assert.equal(result[0], offers[0]);
  assert.deepEqual(offers[0].alternates, [
    { source: JobSource.ADZUNA, applyUrl: offers[1].applyUrl },
    { source: JobSource.CAREERJET, applyUrl: offers[ELEVENTH_INDEX].applyUrl },
  ]);
  assert.equal(offers[0].alternates.some((alternate) => {
    return alternate.source === offers[0].source;
  }), false);
});

test("semantic relation is rejected across different normalized companies", () => {
  const refiner = createRefiner();
  const jems = createCompanyOffer(JobSource.ADZUNA, "JEMS", "jems");
  const geser = createCompanyOffer(JobSource.HELLOWORK, "Geser Best", "geser");

  assert.deepEqual(refiner.collapse([jems, geser], [[0, 1]]), [jems, geser]);
});

test("SULLY same-provider semantic proposal keeps both IA offers", () => {
  const refiner = createRefiner();
  const first = createCompanyOffer(JobSource.ADZUNA, "SULLY GROUP", "sully-ia");
  const second = createCompanyOffer(JobSource.ADZUNA, "SULLY GROUP", "sully-ia-llm");
  first.title = "Développeur IA F/H";
  second.title = "Développeur IA LLM F/H";

  assert.deepEqual(refiner.collapse([first, second], [[0, 1]]), [first, second]);
});

test("cross-provider shared IA token is not semantic duplicate evidence", () => {
  const refiner = createRefiner();
  const first = createCompanyOffer(JobSource.ADZUNA, "SULLY GROUP", "sully-ia");
  const second = createCompanyOffer(JobSource.HELLOWORK, "SULLY GROUP", "sully-ia-llm");
  first.title = "Développeur IA F/H";
  second.title = "Développeur IA LLM F/H";

  assert.deepEqual(refiner.collapse([first, second], [[0, 1]]), [first, second]);
});

test("cross-provider strong description containment validates different titles", () => {
  const refiner = createRefiner();
  const containedDescription = Array.from({ length: LONG_DESCRIPTION_LENGTH }, (unused, index) => {
    return `token${index}`;
  }).join(" ");
  const first = new JobOffer({
    source: JobSource.ADZUNA,
    sourceId: "contained-first",
    title: "Développeur IA",
    description: containedDescription,
    company: new Company({ name: "Example" }),
    location: new JobLocation({ city: "Annecy" }),
    salary: new Salary({}),
  });
  const second = new JobOffer({
    source: JobSource.HELLOWORK,
    sourceId: "contained-second",
    title: "Ingénieur apprentissage automatique",
    description: `${containedDescription} additional`,
    company: new Company({ name: "Example" }),
    location: new JobLocation({ city: "Lyon" }),
    salary: new Salary({}),
  });

  assert.deepEqual(refiner.collapse([first, second], [[0, 1]]), [second]);
});

test("overlapping Geser relations form one component of four", () => {
  const refiner = createRefiner();
  const offers = Array.from({ length: FOURTEEN_OFFERS }, (unused, index) => {
    return createCompanyOffer(JobSource.ADZUNA, `Separate ${index}`, `separate-${index}`);
  });
  const geserIndices = [ADZUNA_INDEX, TENTH_INDEX, TWELFTH_INDEX, THIRTEENTH_INDEX];
  const geserSources = [
    JobSource.ADZUNA,
    JobSource.HELLOWORK,
    JobSource.CAREERJET,
    JobSource.FRANCE_TRAVAIL,
  ];
  for (let position = 0; position < geserIndices.length; position += 1) {
    const index = geserIndices[position];
    offers[index] = createCompanyOffer(
      geserSources[position],
      "Geser Best",
      `geser-${index}`,
    );
  }

  const result = refiner.collapse(offers, [
    [ADZUNA_INDEX, TENTH_INDEX],
    [ADZUNA_INDEX, TWELFTH_INDEX],
    [ADZUNA_INDEX, THIRTEENTH_INDEX],
  ]);

  assert.equal(result.length, ELEVENTH_INDEX);
  const representative = result.find((offer) => {
    return offer.company?.name === "Geser Best";
  });
  assert.ok(representative);
  assert.notEqual(representative.source, JobSource.CAREERJET);
  assert.equal(representative.alternates.length, FOUR_OFFERS - 1);
});

test("every pair in a mixed three-member group is guarded independently", () => {
  const refiner = createRefiner();
  const jems = createCompanyOffer(JobSource.ADZUNA, "JEMS", "jems");
  const firstGeser = createCompanyOffer(JobSource.ADZUNA, "Geser Best", "geser-first");
  const secondGeser = createCompanyOffer(JobSource.HELLOWORK, "Geser Best", "geser-second");

  const result = refiner.collapse([jems, firstGeser, secondGeser], [
    [0, 1, THIRD_GROUP_INDEX],
  ]);

  assert.deepEqual(result, [jems, firstGeser]);
  assert.deepEqual(firstGeser.alternates, [{
    source: JobSource.HELLOWORK,
    applyUrl: secondGeser.applyUrl,
  }]);
});

test("semantic relation is rejected when either company is absent", () => {
  const refiner = createRefiner();
  const missing = createCompanyOffer(JobSource.ADZUNA, null, "missing");
  const known = createCompanyOffer(JobSource.HELLOWORK, "Example", "known");

  assert.deepEqual(refiner.collapse([missing, known], [[0, 1]]), [missing, known]);
});

test("invalid cross-company relation cannot contaminate valid components", () => {
  const refiner = createRefiner();
  const firstAlpha = createCompanyOffer(JobSource.ADZUNA, "Alpha", "alpha-first");
  const secondAlpha = createCompanyOffer(JobSource.HELLOWORK, "Alpha", "alpha-second");
  const firstBeta = createCompanyOffer(JobSource.ADZUNA, "Beta", "beta-first");
  const secondBeta = createCompanyOffer(JobSource.HELLOWORK, "Beta", "beta-second");

  const result = refiner.collapse(
    [firstAlpha, secondAlpha, firstBeta, secondBeta],
    [[0, 1], [1, THIRD_GROUP_INDEX], [THIRD_GROUP_INDEX, FOUR_OFFERS - 1]],
  );

  assert.deepEqual(result, [firstAlpha, firstBeta]);
  assert.deepEqual(firstAlpha.alternates, [{
    source: JobSource.HELLOWORK,
    applyUrl: secondAlpha.applyUrl,
  }]);
  assert.deepEqual(firstBeta.alternates, [{
    source: JobSource.HELLOWORK,
    applyUrl: secondBeta.applyUrl,
  }]);
});

test("semantic snippets remain bounded by the configured limit", () => {
  const refiner = createRefiner();
  const description = "x".repeat(
    GroqConstants.DESCRIPTION_SNIPPET_LENGTH + EXCESS_SNIPPET_LENGTH,
  );

  assert.equal(
    refiner.buildSnippet(description).length,
    GroqConstants.DESCRIPTION_SNIPPET_LENGTH,
  );
});

test("rich Careerjet SEARCH content remains bounded to the historical semantic snippet", () => {
  const refiner = createRefiner();
  const careerjet = createOffer(JobSource.CAREERJET, LONG_DESCRIPTION_LENGTH);
  const prompt = refiner.buildUserPrompt([careerjet], { keywords: "Developer" });

  assert.equal(prompt.includes(careerjet.description), false);
  assert.equal(
    prompt.includes("x".repeat(GroqConstants.DESCRIPTION_SNIPPET_LENGTH)),
    true,
  );
});

test("semantic prompt uses only bounded automatic description and hides full OfferContent", () => {
  const refiner = createRefiner();
  const automaticValue = "a".repeat(LONG_DESCRIPTION_LENGTH);
  const offer = new JobOffer({
    source: JobSource.ADZUNA,
    sourceId: "adzuna-content",
    title: "Developer",
    company: new Company({ name: "Example" }),
    location: new JobLocation({ city: "Annecy" }),
    salary: new Salary({}),
    offerContent: new OfferContent({
      automaticText: {
        value: automaticValue,
        acquisition: OfferContentAcquisition.SEARCH,
        retrievedAt: RETRIEVED_AT,
        completeness: OfferContentCompleteness.KNOWN_TRUNCATED,
      },
      userText: { value: "Private user text", providedAt: RETRIEVED_AT },
    }),
  });
  const prompt = refiner.buildUserPrompt([offer], { keywords: "Developer" });

  assert.equal(prompt.includes(automaticValue), false);
  assert.equal(prompt.includes("a".repeat(GroqConstants.DESCRIPTION_SNIPPET_LENGTH)), true);
  assert.equal(prompt.includes("Private user text"), false);
  assert.equal(prompt.includes("offerContent"), false);
});

test("semantic fallback preserves exact-deduped offers on timeout or network failure", async () => {
  const offers = [createOffer(JobSource.ADZUNA), createOffer(JobSource.HELLOWORK)];
  const failures = [new Error("request timed out"), new Error("network unavailable")];
  for (const failure of failures) {
    const refiner = createConfiguredRefiner();
    refiner.requestAnalysis = async () => {
      throw failure;
    };

    assert.deepEqual(await refiner.refine(offers, { keywords: "Developer" }), offers);
  }
});

test("semantic fallback preserves exact-deduped offers on HTTP 429", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return {
      ok: false,
      status: 429,
      async text() {
        return "rate limited";
      },
    };
  };
  try {
    const refiner = createConfiguredRefiner();
    const offers = [createOffer(JobSource.ADZUNA), createOffer(JobSource.HELLOWORK)];

    assert.deepEqual(await refiner.refine(offers, { keywords: "Developer" }), offers);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("semantic fallback preserves exact-deduped offers on invalid Groq JSON", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return {
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: "{invalid" } }],
        };
      },
    };
  };
  try {
    const refiner = createConfiguredRefiner();
    const offers = [createOffer(JobSource.ADZUNA), createOffer(JobSource.HELLOWORK)];

    assert.deepEqual(await refiner.refine(offers, { keywords: "Developer" }), offers);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
