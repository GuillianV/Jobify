import test from "node:test";
import assert from "node:assert/strict";
import { OfferSearchService } from "../../src/services/OfferSearchService.js";
import { getEligibleRepresentatives } from "../../src/services/OfferRepresentativePolicy.js";
import { JobOffer } from "../../src/models/JobOffer.js";
import { Company } from "../../src/models/Company.js";
import { JobLocation } from "../../src/models/JobLocation.js";
import { Salary } from "../../src/models/Salary.js";
import { JobSource } from "../../src/constants/JobSource.js";
import { OfferIdentityKind } from "../../src/constants/OfferIdentityKind.js";

const FIRST_ID = 1;
const SECOND_ID = 2;
const TWO_OFFERS = 2;
const OLD_DATE = "2000-01-01T00:00:00.000Z";

/**
 * Build a recent provider observation for pipeline tests.
 * @param {object} overrides - Attribute overrides.
 * @returns {JobOffer} Provider observation.
 */
function createOffer(overrides = {}) {
  return new JobOffer({
    source: JobSource.ADZUNA,
    sourceId: "source-id",
    identityKind: OfferIdentityKind.STABLE,
    title: "Developer",
    description: "Description",
    company: new Company({ name: "Example" }),
    location: new JobLocation({ city: "Annecy" }),
    salary: new Salary({}),
    publishedAt: new Date().toISOString(),
    ...overrides,
  });
}

/**
 * Hydrate an observation with a test persistence id.
 * @param {JobOffer} offer - Observation to hydrate.
 * @param {number} id - Internal id.
 * @returns {JobOffer} Hydrated observation.
 */
function hydrate(offer, id) {
  return JobOffer.fromPersistence(id, offer.toJson());
}

/**
 * Build a service with observable repository and semantic test doubles.
 * @param {JobOffer[]} connectorOffers - Connector results.
 * @param {(offers: JobOffer[]) => JobOffer[]} refine - Semantic behavior.
 * @returns {object} Service and captured calls.
 */
function createService(connectorOffers, refine = (offers) => {
  return offers;
}) {
  const calls = { persisted: null, refined: null };
  const connector = {
    isConfigured() {
      return true;
    },
    async search() {
      return connectorOffers;
    },
    getSource() {
      return JobSource.ADZUNA;
    },
  };
  const repository = {
    upsertMany(offers) {
      calls.persisted = offers;
      return offers.map((offer, index) => {
        return hydrate(offer, index + FIRST_ID);
      });
    },
  };
  const semanticRefiner = {
    async refine(offers) {
      calls.refined = offers;
      return refine(offers);
    },
  };
  return {
    calls,
    service: new OfferSearchService(
      [connector],
      semanticRefiner,
      repository,
      getEligibleRepresentatives,
    ),
  };
}

test("exact duplicates are both persisted before one representative remains", async () => {
  const first = createOffer({ source: JobSource.ADZUNA, sourceId: "adzuna-id" });
  const second = createOffer({ source: JobSource.HELLOWORK, sourceId: "hellowork-id" });
  const { calls, service } = createService([first, second]);

  const result = await service.search({ keywords: "developer" });

  assert.equal(calls.persisted.length, TWO_OFFERS);
  assert.equal(calls.refined.length, 1);
  assert.equal(result.length, 1);
});

test("semantic equivalents are both persisted before semantic refinement", async () => {
  const first = createOffer({ sourceId: "first", title: "Backend Developer" });
  const second = createOffer({ sourceId: "second", title: "Node Engineer" });
  const { calls, service } = createService([first, second], (offers) => {
    return [offers[0]];
  });

  const result = await service.search({ keywords: "developer" });

  assert.equal(calls.persisted.length, TWO_OFFERS);
  assert.equal(calls.refined.length, TWO_OFFERS);
  assert.equal(result.length, 1);
});

test("only repository-returned hydrated offers continue through the pipeline", async () => {
  const first = createOffer({ sourceId: "first", title: "Backend Developer" });
  const second = createOffer({ sourceId: "second", title: "Node Engineer" });
  const { calls, service } = createService([first, second]);

  const result = await service.search({ keywords: "developer" });

  assert.equal(first.id, null);
  assert.equal(second.id, null);
  assert.equal(calls.refined[0].id, FIRST_ID);
  assert.equal(calls.refined[1].id, SECOND_ID);
  assert.equal(result[0].id, FIRST_ID);
});

test("old observations are filtered before persistence", async () => {
  const recent = createOffer({ sourceId: "recent", title: "Recent" });
  const old = createOffer({ sourceId: "old", title: "Old", publishedAt: OLD_DATE });
  const { calls, service } = createService([old, recent]);

  await service.search({ keywords: "developer" });

  assert.equal(calls.persisted.length, 1);
  assert.equal(calls.persisted[0], recent);
});

test("old Careerjet cannot eliminate a recent exact Adzuna observation", async () => {
  const oldCareerjet = createOffer({
    source: JobSource.CAREERJET,
    sourceId: "careerjet-old",
    identityKind: OfferIdentityKind.SURROGATE,
    publishedAt: OLD_DATE,
  });
  const recentAdzuna = createOffer({
    source: JobSource.ADZUNA,
    sourceId: "adzuna-recent",
  });
  const { calls, service } = createService([oldCareerjet, recentAdzuna]);

  const result = await service.search({ keywords: "developer" });

  assert.equal(oldCareerjet.getDeduplicationKey(), recentAdzuna.getDeduplicationKey());
  assert.deepEqual(calls.persisted, [recentAdzuna]);
  assert.equal(result.length, 1);
  assert.equal(result[0].source, JobSource.ADZUNA);
});

test("recent Careerjet remains when its exact Adzuna alternative is old", async () => {
  const oldAdzuna = createOffer({
    source: JobSource.ADZUNA,
    sourceId: "adzuna-old",
    publishedAt: OLD_DATE,
  });
  const recentCareerjet = createOffer({
    source: JobSource.CAREERJET,
    sourceId: "careerjet-recent",
    identityKind: OfferIdentityKind.SURROGATE,
  });
  const { calls, service } = createService([oldAdzuna, recentCareerjet]);

  const result = await service.search({ keywords: "developer" });

  assert.equal(oldAdzuna.getDeduplicationKey(), recentCareerjet.getDeduplicationKey());
  assert.deepEqual(calls.persisted, [recentCareerjet]);
  assert.equal(result.length, 1);
  assert.equal(result[0].source, JobSource.CAREERJET);
});

test("recent observations rejected semantically remain persisted", async () => {
  const recent = createOffer();
  const { calls, service } = createService([recent], () => {
    return [];
  });

  const result = await service.search({ keywords: "developer" });

  assert.equal(calls.persisted.length, 1);
  assert.equal(result.length, 0);
});

test("exact deduplication applies Careerjet eligibility and preserves group order", () => {
  const { service } = createService([]);
  const firstGroupCareerjet = createOffer({ source: JobSource.CAREERJET, title: "First" });
  const firstGroupAdzuna = createOffer({ source: JobSource.ADZUNA, title: "First" });
  const firstGroupHelloWork = createOffer({ source: JobSource.HELLOWORK, title: "First" });
  const secondGroupCareerjet = createOffer({ source: JobSource.CAREERJET, title: "Second" });
  const thirdGroupAdzuna = createOffer({ source: JobSource.ADZUNA, title: "Third" });
  const thirdGroupHelloWork = createOffer({ source: JobSource.HELLOWORK, title: "Third" });

  const result = service.deduplicate([
    firstGroupCareerjet,
    secondGroupCareerjet,
    firstGroupAdzuna,
    firstGroupHelloWork,
    thirdGroupAdzuna,
    thirdGroupHelloWork,
  ]);

  assert.deepEqual(result, [firstGroupAdzuna, secondGroupCareerjet, thirdGroupAdzuna]);
});

test("exact deduplication selects each documented non-Careerjet alternative", () => {
  const { service } = createService([]);
  const alternatives = [
    JobSource.FRANCE_TRAVAIL,
    JobSource.ADZUNA,
    JobSource.HELLOWORK,
  ];
  for (const source of alternatives) {
    const careerjet = createOffer({ source: JobSource.CAREERJET });
    const alternative = createOffer({ source });

    assert.equal(service.deduplicate([careerjet, alternative])[0], alternative);
  }
});

test("exact deduplication keeps the first of multiple Careerjet candidates", () => {
  const { service } = createService([]);
  const first = createOffer({ source: JobSource.CAREERJET, sourceId: "careerjet-first" });
  const second = createOffer({ source: JobSource.CAREERJET, sourceId: "careerjet-second" });

  assert.equal(first.getDeduplicationKey(), second.getDeduplicationKey());
  assert.deepEqual(service.deduplicate([first, second]), [first]);
});
