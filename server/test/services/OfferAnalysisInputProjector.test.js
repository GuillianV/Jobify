import test from "node:test";
import assert from "node:assert/strict";
import { Company } from "../../src/models/Company.js";
import { JobLocation } from "../../src/models/JobLocation.js";
import { JobOffer } from "../../src/models/JobOffer.js";
import { OfferContent } from "../../src/models/OfferContent.js";
import { Salary } from "../../src/models/Salary.js";
import { OfferContentAcquisition } from "../../src/constants/OfferContentAcquisition.js";
import { OfferContentCompleteness } from "../../src/constants/OfferContentCompleteness.js";
import { OfferAnalysisConstants } from "../../src/constants/OfferAnalysisConstants.js";
import { OfferAnalysisInputProjector } from "../../src/services/OfferAnalysisInputProjector.js";

const OFFER_ID = 1;
const AUTOMATIC_TEXT = "Automatic text";
const USER_TEXT = " User text ";
const TIMESTAMP = "2026-08-11T10:00:00.000Z";

/**
 * Build one hydrated offer with exact model fields.
 * @param {object} [overrides] - Offer field overrides.
 * @returns {JobOffer} Hydrated offer.
 */
function createOffer(overrides = {}) {
  return new JobOffer({
    id: OFFER_ID,
    source: "france-travail",
    sourceId: "source-id",
    title: "Developer",
    offerContent: new OfferContent({
      automaticText: {
        value: AUTOMATIC_TEXT,
        acquisition: OfferContentAcquisition.SEARCH,
        retrievedAt: TIMESTAMP,
        completeness: OfferContentCompleteness.PROVIDER_FULL,
      },
    }),
    company: new Company({
      name: "Example",
      description: "Excluded",
      url: "https://example.test",
      logoUrl: "https://example.test/logo.png",
    }),
    location: new JobLocation({
      label: "Annecy, France",
      city: "Annecy",
      postalCode: "74000",
      country: "France",
      latitude: 45.9,
      longitude: 6.1,
    }),
    contractType: "CDI",
    contractTypeLabel: "Contrat à durée indéterminée",
    salary: new Salary({
      min: 40000,
      max: 50000,
      currency: "EUR",
      period: "YEARLY",
      raw: "40 000 à 50 000 EUR par an",
    }),
    applyUrl: "https://example.test/apply",
    publishedAt: TIMESTAMP,
    alternates: [{ source: "adzuna", applyUrl: "https://example.test/other" }],
    ...overrides,
  });
}

test("input projection prefers exact user text and fingerprints every change", () => {
  const projector = new OfferAnalysisInputProjector();
  const automaticOffer = createOffer();
  const userOffer = createOffer({
    offerContent: automaticOffer.offerContent.withUserText(USER_TEXT, TIMESTAMP),
  });
  const changedWhitespace = createOffer({
    offerContent: automaticOffer.offerContent.withUserText(`${USER_TEXT} `, TIMESTAMP),
  });

  const automaticInput = projector.build(automaticOffer);
  const userInput = projector.build(userOffer);
  const changedInput = projector.build(changedWhitespace);

  assert.equal(automaticInput.effectiveText, AUTOMATIC_TEXT);
  assert.equal(
    automaticInput.effectiveContentOrigin,
    OfferAnalysisConstants.EFFECTIVE_CONTENT_ORIGIN.AUTOMATIC,
  );
  assert.equal(userInput.effectiveText, USER_TEXT);
  assert.equal(
    userInput.effectiveContentOrigin,
    OfferAnalysisConstants.EFFECTIVE_CONTENT_ORIGIN.USER,
  );
  assert.notEqual(userInput.contentFingerprint, automaticInput.contentFingerprint);
  assert.notEqual(userInput.contentFingerprint, changedInput.contentFingerprint);
});

test("snapshot projects real value-object fields and excludes content and application data", () => {
  const snapshot = new OfferAnalysisInputProjector().build(createOffer()).offerSnapshot;

  assert.deepEqual(snapshot, {
    offerId: OFFER_ID,
    source: "france-travail",
    title: "Developer",
    company: { name: "Example" },
    location: {
      label: "Annecy, France",
      city: "Annecy",
      postalCode: "74000",
      country: "France",
    },
    contract: {
      type: "CDI",
      label: "Contrat à durée indéterminée",
    },
    salary: {
      min: 40000,
      max: 50000,
      currency: "EUR",
      period: "YEARLY",
      raw: "40 000 à 50 000 EUR par an",
    },
  });
  for (const excluded of [
    "description",
    "offerContent",
    "applyUrl",
    "alternates",
    "publishedAt",
  ]) {
    assert.equal(Object.hasOwn(snapshot, excluded), false);
  }
  assert.equal(Object.hasOwn(snapshot.location, "latitude"), false);
  assert.equal(Object.hasOwn(snapshot.location, "longitude"), false);
  assert.equal(Object.hasOwn(snapshot.company, "url"), false);
});

test("missing company and absent optional model values are represented with null", () => {
  const offer = createOffer({
    company: new Company({}),
    location: new JobLocation({}),
    contractType: undefined,
    contractTypeLabel: null,
    salary: new Salary({}),
  });
  const snapshot = new OfferAnalysisInputProjector().build(offer).offerSnapshot;

  assert.equal(snapshot.company, null);
  assert.deepEqual(snapshot.location, {
    label: null,
    city: null,
    postalCode: null,
    country: null,
  });
  assert.deepEqual(snapshot.contract, { type: null, label: null });
  assert.deepEqual(snapshot.salary, {
    min: null,
    max: null,
    currency: null,
    period: "UNKNOWN",
    raw: null,
  });
});

test("non-finite salary amounts become null before canonical fingerprinting", () => {
  const projector = new OfferAnalysisInputProjector();
  const offer = createOffer({
    salary: new Salary({
      min: Number.NaN,
      max: Number.POSITIVE_INFINITY,
      currency: "EUR",
      period: "YEARLY",
      raw: "Invalid numeric amounts",
    }),
  });
  const input = projector.build(offer);

  assert.equal(input.offerSnapshot.salary.min, null);
  assert.equal(input.offerSnapshot.salary.max, null);
  assert.match(input.deterministicInputFingerprint, /^[a-f\d]+$/u);
  assert.throws(() => {
    projector.canonicalSerialize({ amount: Number.NaN });
  }, /finite numbers/u);
  assert.throws(() => {
    projector.canonicalSerialize({ amount: Number.NEGATIVE_INFINITY });
  }, /finite numbers/u);
});

test("canonical serialization ignores object insertion order and preserves arrays", () => {
  const projector = new OfferAnalysisInputProjector();
  const first = {
    nested: { second: "b", first: "a" },
    values: ["second", "first"],
  };
  const second = {
    values: ["second", "first"],
    nested: { first: "a", second: "b" },
  };

  assert.equal(projector.canonicalSerialize(first), projector.canonicalSerialize(second));
  assert.equal(
    projector.hash(projector.canonicalSerialize(first)),
    projector.hash(projector.canonicalSerialize(second)),
  );
  assert.notEqual(
    projector.canonicalSerialize(first),
    projector.canonicalSerialize({ ...second, values: ["first", "second"] }),
  );
});

test("projector rejects absent effective text and non-JobOffer inputs", () => {
  const projector = new OfferAnalysisInputProjector();
  assert.throws(() => {
    projector.build(createOffer({ offerContent: new OfferContent() }));
  }, /requires effective text/u);
  assert.throws(() => {
    projector.build({});
  }, /requires a JobOffer/u);
});
