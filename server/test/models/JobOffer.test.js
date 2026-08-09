import test from "node:test";
import assert from "node:assert/strict";
import { JobOffer } from "../../src/models/JobOffer.js";
import { OfferIdentityKind } from "../../src/constants/OfferIdentityKind.js";

const INTERNAL_ID = 42;

const PAYLOAD = Object.freeze({
  source: "provider",
  sourceId: "external-id",
  title: "Developer",
  company: { name: "Example" },
  location: { city: "Annecy" },
  salary: {},
});

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
