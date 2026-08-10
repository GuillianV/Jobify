import test from "node:test";
import assert from "node:assert/strict";
import { DeterministicOfferDeduplicator } from "../../src/services/DeterministicOfferDeduplicator.js";
import { StrongDescriptionContainment } from "../../src/services/StrongDescriptionContainment.js";
import { OfferRepresentativeSelector } from "../../src/services/OfferRepresentativeSelector.js";
import { OfferTitleNormalizer } from "../../src/normalization/OfferTitleNormalizer.js";
import { getEligibleRepresentatives } from "../../src/services/OfferRepresentativePolicy.js";
import { DeduplicationConstants } from "../../src/constants/DeduplicationConstants.js";
import { JobOffer } from "../../src/models/JobOffer.js";
import { Company } from "../../src/models/Company.js";
import { JobLocation } from "../../src/models/JobLocation.js";
import { Salary } from "../../src/models/Salary.js";
import { JobSource } from "../../src/constants/JobSource.js";

const IKIGAI_OBSERVATION_COUNT = 3;
const GESER_OBSERVATION_COUNT = 4;

/**
 * Create the deterministic deduplicator under test.
 * @returns {DeterministicOfferDeduplicator} Configured service.
 */
function createDeduplicator() {
  return new DeterministicOfferDeduplicator(
    new OfferTitleNormalizer(),
    new StrongDescriptionContainment(),
    new OfferRepresentativeSelector(getEligibleRepresentatives),
  );
}

/**
 * Build audited-length deterministic description evidence.
 * @param {string} suffix - Final distinguishing token.
 * @returns {string} Description with sufficient distinct tokens.
 */
function createDescription(suffix) {
  const tokens = Array.from(
    { length: DeduplicationConstants.MIN_DESCRIPTION_DISTINCT_TOKENS },
    (unused, index) => {
      return `token${index}`;
    },
  );
  tokens[tokens.length - 1] = suffix;
  return tokens.join(" ");
}

/**
 * Build one canonical offer observation.
 * @param {object} values - Offer overrides.
 * @returns {JobOffer} Offer.
 */
function createOffer(values) {
  return new JobOffer({
    source: values.source,
    sourceId: values.sourceId,
    title: values.title,
    description: values.description ?? null,
    company: new Company({ name: values.company }),
    location: new JobLocation({ city: values.city }),
    salary: new Salary({}),
    applyUrl: `https://example.com/${values.sourceId}`,
  });
}

test("canonical title removes provider punctuation gender markers and company suffix", () => {
  const normalizer = new OfferTitleNormalizer();

  assert.equal(
    normalizer.canonicalize(
      "Développeur Full Stack - Hf H/F - Geser Best",
      "Geser Best",
    ),
    "developpeur full stack",
  );
  assert.equal(
    normalizer.canonicalize("Développeur Node.Js / Angular expérimenté F/H", "Ikigaï"),
    "developpeur node js angular experimente",
  );
});

test("strong description containment applies the audited token rule", () => {
  const policy = new StrongDescriptionContainment();
  const first = createDescription("first");
  const oneMissing = createDescription("second");
  const insufficient = "short description";

  assert.equal(policy.matches(first, oneMissing), true);
  assert.equal(policy.matches(first, insufficient), false);
});

test("Ikigai three real title and city variants form one obvious component", () => {
  const common = createDescription("adzuna");
  const corroborating = createDescription("hellowork");
  const offers = [
    createOffer({
      source: JobSource.ADZUNA,
      sourceId: "ikigai-a",
      title: "Développeur Node.Js / Angular expérimenté F/H",
      company: "Ikigaï",
      city: "Annecy",
      description: common,
    }),
    createOffer({
      source: JobSource.CAREERJET,
      sourceId: "ikigai-b",
      title: "Développeur Node.Js - Angular Expérimenté H/F",
      company: "Ikigai",
      city: "Argonay",
      description: corroborating,
    }),
    createOffer({
      source: JobSource.HELLOWORK,
      sourceId: "ikigai-c",
      title: "Développeur Node.Js - Angular Expérimenté H/F",
      company: "Ikigaï",
      city: "Annecy",
    }),
  ];

  const result = createDeduplicator().deduplicate(offers);

  assert.equal(offers.length, IKIGAI_OBSERVATION_COUNT);
  assert.equal(result.length, 1);
});

test("Geser four real title and city variants form one obvious component", () => {
  const common = createDescription("adzuna");
  const corroborating = createDescription("hellowork");
  const offers = [
    createOffer({ source: JobSource.ADZUNA, sourceId: "geser-a", title: "Développeur Full Stack - Hf H/F", company: "Geser Best", city: "Argonay", description: common }),
    createOffer({ source: JobSource.CAREERJET, sourceId: "geser-b", title: "Développeur Full Stack - Hf H/F - Geser Best", company: "Geser Best", city: "Annecy", description: corroborating }),
    createOffer({ source: JobSource.HELLOWORK, sourceId: "geser-c", title: "Développeur Full Stack H/F", company: "Geser Best", city: "Annecy" }),
    createOffer({ source: JobSource.FRANCE_TRAVAIL, sourceId: "geser-d", title: "Développeur Full Stack - Hf H/F", company: "Geser Best", city: "Annecy" }),
  ];

  const result = createDeduplicator().deduplicate(offers);

  assert.equal(offers.length, GESER_OBSERVATION_COUNT);
  assert.equal(result.length, 1);
});

test("obvious dedup rejects unsafe company title city and provider cases", () => {
  const deduplicator = createDeduplicator();
  const base = createOffer({ source: JobSource.ADZUNA, sourceId: "base", title: "Développeur Backend H/F", company: "Geser Best", city: "Annecy" });
  const jems = createOffer({ source: JobSource.HELLOWORK, sourceId: "jems", title: "Développeur Backend H/F", company: "JEMS", city: "Annecy" });
  const otherTitle = createOffer({ source: JobSource.HELLOWORK, sourceId: "title", title: "Développeur Frontend H/F", company: "Geser Best", city: "Annecy" });
  const otherCity = createOffer({ source: JobSource.HELLOWORK, sourceId: "city", title: "Développeur Backend H/F", company: "Geser Best", city: "Lyon" });
  const sameProvider = createOffer({ source: JobSource.ADZUNA, sourceId: "provider", title: "Développeur Backend H/F", company: "Geser Best", city: "Annecy" });
  const missingCompany = createOffer({ source: JobSource.HELLOWORK, sourceId: "company", title: "Développeur Backend H/F", company: null, city: "Annecy" });
  const missingTitle = createOffer({ source: JobSource.HELLOWORK, sourceId: "empty-title", title: "H/F", company: "Geser Best", city: "Annecy" });

  assert.equal(deduplicator.isObviousRelation(base, jems), false);
  assert.equal(deduplicator.isObviousRelation(base, otherTitle), false);
  assert.equal(deduplicator.isObviousRelation(base, otherCity), false);
  assert.equal(deduplicator.isObviousRelation(base, sameProvider), false);
  assert.equal(deduplicator.isObviousRelation(base, missingCompany), false);
  assert.equal(deduplicator.isObviousRelation(base, missingTitle), false);
});

test("multi-stage representative merge preserves flat unique alternates", () => {
  const selector = new OfferRepresentativeSelector(getEligibleRepresentatives);
  const first = createOffer({ source: JobSource.ADZUNA, sourceId: "first", title: "Developer", company: "Example", city: "Annecy" });
  const second = createOffer({ source: JobSource.HELLOWORK, sourceId: "second", title: "Developer", company: "Example", city: "Annecy" });
  const third = createOffer({ source: JobSource.CAREERJET, sourceId: "third", title: "Developer", company: "Example", city: "Annecy" });
  first.alternates = [
    { source: "ats", applyUrl: "https://example.com/a2" },
    { source: "ats", applyUrl: "https://example.com/a3" },
  ];

  selector.mergeComponent([first, second], [0, 1]);
  selector.mergeComponent([first, third], [0, 1]);

  assert.deepEqual(first.alternates, [
    { source: "ats", applyUrl: "https://example.com/a2" },
    { source: "ats", applyUrl: "https://example.com/a3" },
    { source: JobSource.HELLOWORK, applyUrl: second.applyUrl },
    { source: JobSource.CAREERJET, applyUrl: third.applyUrl },
  ]);
});
