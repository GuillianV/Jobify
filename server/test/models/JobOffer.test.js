import test from "node:test";
import assert from "node:assert/strict";
import { JobOffer } from "../../src/models/JobOffer.js";
import { OfferIdentityKind } from "../../src/constants/OfferIdentityKind.js";
import { JobSource } from "../../src/constants/JobSource.js";
import { OfferContent } from "../../src/models/OfferContent.js";
import { OfferContentAcquisition } from "../../src/constants/OfferContentAcquisition.js";
import { OfferContentCompleteness } from "../../src/constants/OfferContentCompleteness.js";
import { Company } from "../../src/models/Company.js";
import { JobLocation } from "../../src/models/JobLocation.js";
import { Salary } from "../../src/models/Salary.js";

const INTERNAL_ID = 42;
const RETRIEVED_AT = "2026-08-01T10:00:00.000Z";

const PAYLOAD = Object.freeze({
  source: "provider",
  sourceId: "external-id",
  title: "Developer",
  company: { name: "Example" },
  location: { city: "Annecy" },
  salary: {},
});

/**
 * Build constructor-ready offer parameters with value objects.
 * @param {object} [overrides] - Values replacing the defaults.
 * @returns {object} Trusted JobOffer parameters.
 */
function createParams(overrides = {}) {
  return {
    source: "provider",
    sourceId: "external-id",
    title: "Developer",
    company: new Company({ name: "Example" }),
    location: new JobLocation({ city: "Annecy" }),
    salary: new Salary({}),
    ...overrides,
  };
}

test("new and external JobOffer instances never acquire an internal id", () => {
  const offer = JobOffer.fromJson({ ...PAYLOAD, id: INTERNAL_ID });

  assert.equal(offer.id, null);
  assert.equal(new JobOffer(PAYLOAD).id, null);
});

test("legacy payloads receive backward-compatible identity defaults", () => {
  const offer = JobOffer.fromJson({ ...PAYLOAD, sourceId: null });

  assert.equal(offer.sourceId, null);
  assert.equal(offer.identityKind, OfferIdentityKind.STABLE);
  assert.equal(offer.surrogateKey, null);
  assert.equal(offer.surrogateMatchable, false);
});

test("fromJson ignores spoofed external identity metadata", () => {
  const offer = JobOffer.fromJson({
    ...PAYLOAD,
    identityKind: OfferIdentityKind.SURROGATE,
    surrogateKey: "spoofed",
    surrogateMatchable: true,
  });

  assert.equal(offer.identityKind, OfferIdentityKind.STABLE);
  assert.equal(offer.surrogateKey, null);
  assert.equal(offer.surrogateMatchable, false);
});

test("fromPersistence restores internal identity metadata", () => {
  const offer = JobOffer.fromPersistence(INTERNAL_ID, {
    ...PAYLOAD,
    id: 1,
    identityKind: OfferIdentityKind.SURROGATE,
    surrogateKey: "fingerprint",
    surrogateMatchable: true,
  });

  assert.equal(offer.id, INTERNAL_ID);
  assert.equal(offer.identityKind, OfferIdentityKind.SURROGATE);
  assert.equal(offer.surrogateKey, "fingerprint");
  assert.equal(offer.surrogateMatchable, true);
});

test("fromPersistence rejects unsupported persisted identity kinds", () => {
  assert.throws(() => {
    JobOffer.fromPersistence(INTERNAL_ID, { ...PAYLOAD, identityKind: "UNKNOWN" });
  }, TypeError);
});

test("public JSON keeps automatic description and hides trusted content", () => {
  const offer = new JobOffer(createParams({
    offerContent: new OfferContent({
      automaticText: {
        value: "Automatic text",
        acquisition: OfferContentAcquisition.SEARCH,
        retrievedAt: RETRIEVED_AT,
        completeness: OfferContentCompleteness.UNKNOWN,
      },
      userText: { value: "User text", providedAt: RETRIEVED_AT },
    }),
  }));
  const json = offer.toJson();

  assert.equal(json.description, "Automatic text");
  assert.equal(json.offerContent, undefined);
  assert.equal(json.id, undefined);
  assert.equal(offer.offerContent.getEffectiveText(), "User text");
});

test("persistent JSON includes trusted content without SQLite identity", () => {
  const offer = new JobOffer(createParams({ description: "Legacy text" }));
  const json = offer.toPersistenceJson();

  assert.equal(json.offerContent.automaticText.value, "Legacy text");
  assert.equal(json.id, undefined);
});

test("fromJson ignores spoofed OfferContent metadata", () => {
  const offer = JobOffer.fromJson({
    ...PAYLOAD,
    source: JobSource.ADZUNA,
    description: "Public description",
    offerContent: {
      automaticText: {
        value: "Spoofed text",
        acquisition: OfferContentAcquisition.DETAIL,
        retrievedAt: RETRIEVED_AT,
        completeness: OfferContentCompleteness.PROVIDER_FULL,
      },
      userText: { value: "Spoofed user text", providedAt: RETRIEVED_AT },
      structured: {
        value: { spoofed: true },
        acquisition: OfferContentAcquisition.DETAIL,
        retrievedAt: RETRIEVED_AT,
      },
    },
  });

  assert.equal(offer.description, "Public description");
  assert.equal(offer.offerContent.automaticText.completeness, OfferContentCompleteness.KNOWN_TRUNCATED);
  assert.equal(offer.offerContent.userText, null);
  assert.equal(offer.offerContent.structured, null);
});

test("fromPersistence restores trusted OfferContent over contradictory legacy description", () => {
  const offer = JobOffer.fromPersistence(INTERNAL_ID, {
    ...PAYLOAD,
    description: "Legacy text",
    offerContent: {
      automaticText: {
        value: "Persistent text",
        acquisition: OfferContentAcquisition.DETAIL,
        retrievedAt: RETRIEVED_AT,
        completeness: OfferContentCompleteness.PROVIDER_FULL,
      },
      userText: null,
      structured: null,
    },
  });

  assert.equal(offer.description, "Persistent text");
  assert.equal(offer.offerContent.automaticText.acquisition, OfferContentAcquisition.DETAIL);
});

test("explicit empty persistent OfferContent does not revive legacy description", () => {
  const offer = JobOffer.fromPersistence(INTERNAL_ID, {
    ...PAYLOAD,
    description: "Contradictory legacy text",
    offerContent: null,
  });

  assert.equal(offer.description, null);
  assert.equal(offer.offerContent.automaticText, null);
});

test("legacy descriptions hydrate with source-specific completeness without dates", () => {
  const policies = [
    [JobSource.FRANCE_TRAVAIL, OfferContentCompleteness.PROVIDER_FULL],
    [JobSource.ADZUNA, OfferContentCompleteness.KNOWN_TRUNCATED],
    [JobSource.CAREERJET, OfferContentCompleteness.KNOWN_TRUNCATED],
    [JobSource.HELLOWORK, OfferContentCompleteness.UNKNOWN],
  ];
  for (const [source, completeness] of policies) {
    const offer = JobOffer.fromPersistence(INTERNAL_ID, {
      ...PAYLOAD,
      source,
      description: "Legacy text",
    });
    assert.equal(offer.offerContent.automaticText.completeness, completeness);
    assert.equal(offer.offerContent.automaticText.retrievedAt, null);
  }
  const empty = JobOffer.fromPersistence(INTERNAL_ID, {
    ...PAYLOAD,
    source: JobSource.HELLOWORK,
    description: " ",
  });
  assert.equal(empty.offerContent.automaticText, null);
});
