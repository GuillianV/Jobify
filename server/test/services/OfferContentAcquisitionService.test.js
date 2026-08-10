import test from "node:test";
import assert from "node:assert/strict";
import { OfferContentAcquisitionService } from "../../src/services/OfferContentAcquisitionService.js";
import { OfferContent } from "../../src/models/OfferContent.js";
import { OfferContentAcquisition } from "../../src/constants/OfferContentAcquisition.js";
import { OfferContentCompleteness } from "../../src/constants/OfferContentCompleteness.js";
import { JobSource } from "../../src/constants/JobSource.js";
import { HttpStatus } from "../../src/constants/HttpStatus.js";
import { OfferContentAcquisitionConstants } from "../../src/constants/OfferContentAcquisitionConstants.js";

const OFFER_ID = 42;
const APPLY_URL = "https://www.hellowork.com/fr-fr/emplois/123.html?source=search#detail";

/**
 * Create a repository stub and acquisition service for one persisted offer.
 * @param {object|null} offer - Persisted offer returned by id.
 * @returns {{service: OfferContentAcquisitionService, calls: object}} Test context.
 */
function createService(offer) {
  const calls = { enriched: null };
  const repository = {
    findById() {
      return offer;
    },
    enrichContentById(id, content) {
      calls.enriched = { id, content };
      return {
        ...offer,
        id,
        offerContent: offer.offerContent.merge(content),
        get description() {
          return this.offerContent.getAutomaticText();
        },
      };
    },
  };
  return { service: new OfferContentAcquisitionService(repository), calls };
}

/**
 * Build one persisted provider observation for acquisition tests.
 * @param {object} [overrides] - Values replacing defaults.
 * @returns {object} Test observation.
 */
function createOffer(overrides = {}) {
  return {
    id: OFFER_ID,
    source: JobSource.HELLOWORK,
    applyUrl: APPLY_URL,
    offerContent: new OfferContent(),
    ...overrides,
  };
}

test("service builds authoritative HelloWork DETAIL metadata and ignores body metadata", () => {
  const { service, calls } = createService(createOffer());
  const result = service.enrichHelloWorkDetail(OFFER_ID, {
    description: "Description DETAIL",
    sourceUrl: APPLY_URL.replace("#detail", "#final"),
    acquisition: OfferContentAcquisition.SEARCH,
    completeness: OfferContentCompleteness.KNOWN_TRUNCATED,
    retrievedAt: "invalid",
    userText: { value: "forbidden" },
    structured: { value: { forbidden: true } },
  });
  const automaticText = calls.enriched.content.automaticText;

  assert.equal(calls.enriched.id, OFFER_ID);
  assert.equal(result.description, "Description DETAIL");
  assert.equal(automaticText.acquisition, OfferContentAcquisition.DETAIL);
  assert.equal(automaticText.completeness, OfferContentCompleteness.PROVIDER_FULL);
  assert.equal(Number.isNaN(Date.parse(automaticText.retrievedAt)), false);
  assert.equal(calls.enriched.content.userText, null);
  assert.equal(calls.enriched.content.structured, null);
});

test("service rejects invalid, missing and non-HelloWork observations", () => {
  const invalid = createService(createOffer()).service;
  assert.throws(() => {
    return invalid.enrichHelloWorkDetail(0, {});
  }, (error) => {
    return error.statusCode === HttpStatus.BAD_REQUEST;
  });
  const missing = createService(null).service;
  assert.throws(() => {
    return missing.enrichHelloWorkDetail(OFFER_ID, {});
  }, (error) => {
    return error.statusCode === HttpStatus.NOT_FOUND;
  });
  const otherSource = createService(createOffer({ source: JobSource.ADZUNA })).service;
  assert.throws(() => {
    return otherSource.enrichHelloWorkDetail(OFFER_ID, {});
  }, (error) => {
    return error.statusCode === HttpStatus.BAD_REQUEST;
  });
});

test("service rejects empty, oversized and mismatched DETAIL payloads without writes", () => {
  const { service, calls } = createService(createOffer());
  const invalidPayloads = [
    { description: " ", sourceUrl: APPLY_URL },
    {
      description: "x".repeat(
        OfferContentAcquisitionConstants.MAXIMUM_DETAIL_DESCRIPTION_LENGTH + 1,
      ),
      sourceUrl: APPLY_URL,
    },
    { description: "Valid", sourceUrl: "http://www.hellowork.com/fr-fr/emplois/123.html" },
    { description: "Valid", sourceUrl: "https://example.com/fr-fr/emplois/123.html" },
    {
      description: "Valid",
      sourceUrl: "https://www.hellowork.com.evil.example/fr-fr/emplois/123.html",
    },
    { description: "Valid", sourceUrl: "https://www.hellowork.com/fr-fr/emplois/other.html" },
  ];
  for (const payload of invalidPayloads) {
    assert.throws(() => {
      return service.enrichHelloWorkDetail(OFFER_ID, payload);
    }, (error) => {
      return error.statusCode === HttpStatus.BAD_REQUEST;
    });
  }

  assert.equal(calls.enriched, null);
});

test("service never degrades better existing content", () => {
  const existingContent = new OfferContent({
    automaticText: {
      value: "Existing DETAIL",
      acquisition: OfferContentAcquisition.DETAIL,
      completeness: OfferContentCompleteness.PROVIDER_FULL,
      retrievedAt: "2099-01-01T00:00:00.000Z",
    },
  });
  const { service } = createService(createOffer({ offerContent: existingContent }));
  const result = service.enrichHelloWorkDetail(OFFER_ID, {
    description: "Older candidate",
    sourceUrl: APPLY_URL,
  });

  assert.equal(result.description, "Existing DETAIL");
});
