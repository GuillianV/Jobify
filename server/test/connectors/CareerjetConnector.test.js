import test from "node:test";
import assert from "node:assert/strict";
import { CareerjetConnector } from "../../src/connectors/CareerjetConnector.js";
import { ContractType } from "../../src/constants/ContractType.js";
import { JobSource } from "../../src/constants/JobSource.js";
import { OfferIdentityKind } from "../../src/constants/OfferIdentityKind.js";
import { OfferContentAcquisition } from "../../src/constants/OfferContentAcquisition.js";
import { OfferContentCompleteness } from "../../src/constants/OfferContentCompleteness.js";
import { CareerjetConstants } from "../../src/constants/CareerjetConstants.js";

const RETRIEVED_AT = "2026-08-03T10:00:00.000Z";
const RICH_TEXT_REPETITIONS = 100;

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
  const offer = connector.mapOffer(RAW_OFFER, RETRIEVED_AT);
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
  assert.equal(offer.offerContent.automaticText.acquisition, OfferContentAcquisition.SEARCH);
  assert.equal(
    offer.offerContent.automaticText.completeness,
    OfferContentCompleteness.UNKNOWN,
  );
  assert.equal(offer.offerContent.automaticText.retrievedAt, RETRIEVED_AT);
  assert.equal(offer.offerContent.structured, null);
});

test("search requests the rich Careerjet fragment without changing historical parameters", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = null;
  let requestedOptions = null;
  globalThis.fetch = async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return {
      ok: true,
      async json() {
        return { jobs: [] };
      },
    };
  };
  try {
    const connector = new CareerjetConnector({ affid: "test-affiliate" });
    await connector.search({ keywords: "Node.js", location: "Annecy" });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requestedUrl.searchParams.get("fragment_size"), "10000");
  assert.equal(requestedUrl.searchParams.getAll("fragment_size").length, 1);
  assert.equal(requestedUrl.searchParams.get("locale_code"), CareerjetConstants.LOCALE_CODE);
  assert.equal(requestedUrl.searchParams.get("keywords"), "Node js");
  assert.equal(requestedUrl.searchParams.get("location"), "Annecy");
  assert.equal(requestedUrl.searchParams.get("affid"), "test-affiliate");
  assert.equal(requestedUrl.searchParams.get("pagesize"), String(CareerjetConstants.PAGE_SIZE));
  assert.equal(requestedUrl.searchParams.get("user_ip"), CareerjetConstants.USER_IP);
  assert.equal(requestedUrl.searchParams.get("user_agent"), CareerjetConstants.USER_AGENT);
  assert.deepEqual(requestedOptions.headers, {
    Referer: CareerjetConstants.REFERER,
    "User-Agent": CareerjetConstants.USER_AGENT,
  });
});

test("rich Careerjet content stays complete through normalization and contract inference", () => {
  const connector = new CareerjetConnector({ affid: "test-affiliate" });
  const richDescription = `<p>PremiÃ¨re mission</p><p>${"Contenu utile ".repeat(RICH_TEXT_REPETITIONS)}CDI</p>`;
  const offer = connector.mapOffer({
    ...RAW_OFFER,
    description: richDescription,
  }, RETRIEVED_AT);

  assert.equal(offer.description.startsWith("PremiÃ¨re mission\n\nContenu utile"), true);
  assert.equal(offer.description.endsWith("CDI"), true);
  assert.equal(offer.contractType, ContractType.CDI);
  assert.equal(offer.offerContent.automaticText.acquisition, OfferContentAcquisition.SEARCH);
  assert.equal(offer.offerContent.automaticText.completeness, OfferContentCompleteness.UNKNOWN);
});

test("Careerjet surrogate stays stable for repeated rich content and changes with fragment length", () => {
  const connector = new CareerjetConnector({ affid: "test-affiliate" });
  const short = connector.mapOffer({ ...RAW_OFFER, description: "Fragment court" });
  const richPayload = { ...RAW_OFFER, description: "Fragment court avec la suite riche" };
  const firstRich = connector.mapOffer(richPayload);
  const secondRich = connector.mapOffer(richPayload);

  assert.equal(firstRich.surrogateKey, secondRich.surrogateKey);
  assert.notEqual(short.surrogateKey, firstRich.surrogateKey);
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
