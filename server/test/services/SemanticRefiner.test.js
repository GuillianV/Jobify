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

const LONG_DESCRIPTION_LENGTH = 500;
const SHORT_DESCRIPTION_LENGTH = 20;
const EXCESS_SNIPPET_LENGTH = 40;
const CAREERJET_INDEX = 2;
const ADZUNA_INDEX = 5;
const HELLOWORK_INDEX = 8;
const OFFER_ARRAY_LENGTH = 9;
const TWO_ALTERNATES = 2;
const THIRD_GROUP_INDEX = 2;
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
    getEligibleRepresentatives,
  );
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
