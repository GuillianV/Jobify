import test from "node:test";
import assert from "node:assert/strict";
import { CareerjetConnector } from "../../src/connectors/CareerjetConnector.js";
import { ContractType } from "../../src/constants/ContractType.js";
import { JobSource } from "../../src/constants/JobSource.js";
import { OfferIdentityKind } from "../../src/constants/OfferIdentityKind.js";

const RAW_OFFER = Object.freeze({
  title: "Développeur backend",
  description: "<b>Node</b>.<b>js</b>",
  company: "Example Tech",
  locations: "Annecy, Haute-Savoie",
  salary: "45 000 euros annuel",
  url: "https://example.com/careerjet/backend",
  date: "2026-08-01T10:00:00Z",
});

test("mapOffer cleans Careerjet descriptions and preserves essential fields", () => {
  const connector = new CareerjetConnector({ affid: "test-affiliate" });
  const offer = connector.mapOffer(RAW_OFFER);
  const json = offer.toJson();

  assert.equal(offer.description, "Node.js");
  assert.equal(json.description, "Node.js");
  assert.equal(json.source, JobSource.CAREERJET);
  assert.equal(json.sourceId, RAW_OFFER.url);
  assert.equal(json.identityKind, OfferIdentityKind.SURROGATE);
  assert.equal(json.surrogateMatchable, true);
  assert.equal(json.title, RAW_OFFER.title);
  assert.equal(json.company.name, RAW_OFFER.company);
  assert.equal(json.location.label, RAW_OFFER.locations);
  assert.equal(json.location.city, "Annecy");
  assert.equal(json.applyUrl, RAW_OFFER.url);
  assert.equal(json.publishedAt, "2026-08-01T10:00:00.000Z");
  assert.equal(json.salary.raw, RAW_OFFER.salary);
});

test("mapOffer builds a deterministic surrogate independent of Careerjet URLs", () => {
  const connector = new CareerjetConnector({ affid: "test-affiliate" });
  const first = connector.mapOffer(RAW_OFFER);
  const second = connector.mapOffer({
    ...RAW_OFFER,
    url: "https://example.com/careerjet/rotated",
  });

  assert.equal(first.surrogateKey, second.surrogateKey);
  assert.equal(first.surrogateMatchable, true);
});

test("mapOffer marks incomplete Careerjet surrogates as non-matchable", () => {
  const connector = new CareerjetConnector({ affid: "test-affiliate" });
  const offer = connector.mapOffer({ ...RAW_OFFER, company: null });

  assert.equal(typeof offer.surrogateKey, "string");
  assert.equal(offer.surrogateMatchable, false);
});

test("mapOffer infers the Careerjet contract from the cleaned description", () => {
  const connector = new CareerjetConnector({ affid: "test-affiliate" });
  const offer = connector.mapOffer({
    ...RAW_OFFER,
    description: "Poste en <b>CDI</b>",
  });

  assert.equal(offer.description, "Poste en CDI");
  assert.equal(offer.contractType, ContractType.CDI);
});

test("mapOffer preserves a null Careerjet description", () => {
  const connector = new CareerjetConnector({ affid: "test-affiliate" });
  const offer = connector.mapOffer({ ...RAW_OFFER, description: null });

  assert.equal(offer.description, null);
  assert.equal(offer.toJson().description, null);
});
