import test from "node:test";
import assert from "node:assert/strict";
import { HttpStatus } from "../../src/constants/HttpStatus.js";
import { JobSource } from "../../src/constants/JobSource.js";
import { OfferContentAcquisition } from "../../src/constants/OfferContentAcquisition.js";
import { OfferContentCompleteness } from "../../src/constants/OfferContentCompleteness.js";
import { OfferContentEvaluationConstants } from "../../src/constants/OfferContentEvaluationConstants.js";
import { OfferContentLimits } from "../../src/constants/OfferContentLimits.js";
import { OfferPreparationConstants } from "../../src/constants/OfferPreparationConstants.js";
import { OfferContent } from "../../src/models/OfferContent.js";
import { HelloWorkUrlPolicy } from "../../src/services/HelloWorkUrlPolicy.js";
import { OfferContentEvaluator } from "../../src/services/OfferContentEvaluator.js";
import { OfferPreparationService } from "../../src/services/OfferPreparationService.js";

const OFFER_ID = 42;
const RICH_WORD_COUNT = 130;
const FIRST_TIME = "2026-08-10T10:00:00.000Z";
const SECOND_TIME = "2026-08-10T11:00:00.000Z";
const HELLOWORK_URL = "https://www.hellowork.com/fr-fr/emplois/123.html";

/**
 * Build deterministic synthetic content exceeding every sufficiency threshold.
 * @returns {string} Long lexically diverse text.
 */
function buildRichText() {
  return Array.from({ length: RICH_WORD_COUNT }, (_, index) => {
    return `competence${index}`;
  }).join(" ");
}

/**
 * Build one persisted-offer shape used by preparation tests.
 * @param {object} [overrides] - Values replacing defaults.
 * @returns {object} Persisted observation shape.
 */
function createOffer(overrides = {}) {
  return {
    id: OFFER_ID,
    source: JobSource.ADZUNA,
    applyUrl: "https://example.com/offer",
    offerContent: new OfferContent(),
    ...overrides,
  };
}

/**
 * Build automatic text with overridable acquisition metadata.
 * @param {string} value - Provider text.
 * @param {string} [acquisition] - Acquisition channel.
 * @returns {OfferContent} Automatic offer content.
 */
function automaticContent(value, acquisition = OfferContentAcquisition.SEARCH) {
  return new OfferContent({
    automaticText: {
      value,
      acquisition,
      completeness: OfferContentCompleteness.PROVIDER_FULL,
      retrievedAt: FIRST_TIME,
    },
  });
}

/**
 * Create a mutable repository stub and real preparation policies.
 * @param {object|null} initialOffer - Initial authoritative observation.
 * @param {string[]} [timestamps] - Server timestamps returned successively.
 * @returns {{calls: object, getOffer: Function, service: OfferPreparationService}} Context.
 */
function createContext(initialOffer, timestamps = [FIRST_TIME, SECOND_TIME]) {
  let offer = initialOffer;
  let timestampIndex = 0;
  const calls = { findCount: 0, replaceCount: 0, nowCount: 0 };
  const repository = {
    findById(id) {
      calls.findCount += 1;
      return id === OFFER_ID ? offer : null;
    },
    replaceUserTextById(id, value, providedAt) {
      calls.replaceCount += 1;
      if (id !== OFFER_ID || !offer) {
        return null;
      }
      offer = {
        ...offer,
        offerContent: offer.offerContent.withUserText(value, providedAt),
      };
      return offer;
    },
  };
  const service = new OfferPreparationService(
    repository,
    new OfferContentEvaluator(),
    new HelloWorkUrlPolicy(),
    () => {
      calls.nowCount += 1;
      const timestamp = timestamps[timestampIndex] ?? timestamps.at(-1);
      timestampIndex += 1;
      return timestamp;
    },
  );
  return {
    calls,
    getOffer() {
      return offer;
    },
    service,
  };
}

test("prepare returns READY for sufficient automatic content without writing", () => {
  const context = createContext(createOffer({ offerContent: automaticContent(buildRichText()) }));
  const first = context.service.prepare(OFFER_ID);
  const second = context.service.prepare(OFFER_ID);

  assert.equal(first.prepareStatus, OfferPreparationConstants.STATUS.READY);
  assert.equal(first.evaluation.status, OfferContentEvaluationConstants.STATUS.SUFFICIENT);
  assert.equal(first.providerAcquisition, null);
  assert.equal(context.calls.replaceCount, 0);
  assert.equal(context.calls.nowCount, 0);
  assert.deepEqual(first, second);
});

test("prepare requests authoritative HelloWork DETAIL only when it can help", () => {
  const offer = createOffer({
    source: JobSource.HELLOWORK,
    applyUrl: HELLOWORK_URL,
  });
  const result = createContext(offer).service.prepare(OFFER_ID);

  assert.equal(
    result.prepareStatus,
    OfferPreparationConstants.STATUS.NEEDS_PROVIDER_ACQUISITION,
  );
  assert.deepEqual(result.providerAcquisition, {
    kind: OfferPreparationConstants.PROVIDER_ACQUISITION_KIND.HELLOWORK_DETAIL,
    source: JobSource.HELLOWORK,
    url: HELLOWORK_URL,
  });
});

test("non-HelloWork and invalid HelloWork URLs require user text", () => {
  const offers = [
    createOffer(),
    createOffer({ source: JobSource.HELLOWORK, applyUrl: "http://www.hellowork.com/offer" }),
    createOffer({ source: JobSource.HELLOWORK, applyUrl: "https://example.com/offer" }),
  ];

  for (const offer of offers) {
    const result = createContext(offer).service.prepare(OFFER_ID);
    assert.equal(result.prepareStatus, OfferPreparationConstants.STATUS.NEEDS_USER_TEXT);
    assert.equal(result.providerAcquisition, null);
  }
});

test("an insufficient persisted DETAIL never requests provider acquisition again", () => {
  const offer = createOffer({
    source: JobSource.HELLOWORK,
    applyUrl: HELLOWORK_URL,
    offerContent: automaticContent("Short DETAIL", OfferContentAcquisition.DETAIL),
  });
  const result = createContext(offer).service.prepare(OFFER_ID);

  assert.equal(result.evaluation.status, OfferContentEvaluationConstants.STATUS.INSUFFICIENT);
  assert.equal(result.prepareStatus, OfferPreparationConstants.STATUS.NEEDS_USER_TEXT);
});

test("effective user text prevents provider acquisition and can independently become READY", () => {
  const poorUser = new OfferContent({
    userText: { value: "Short user text", providedAt: FIRST_TIME },
  });
  const richUser = new OfferContent({
    userText: { value: buildRichText(), providedAt: FIRST_TIME },
  });
  const poorResult = createContext(createOffer({
    source: JobSource.HELLOWORK,
    applyUrl: HELLOWORK_URL,
    offerContent: poorUser,
  })).service.prepare(OFFER_ID);
  const richResult = createContext(createOffer({ offerContent: richUser })).service.prepare(OFFER_ID);

  assert.equal(poorResult.prepareStatus, OfferPreparationConstants.STATUS.NEEDS_USER_TEXT);
  assert.equal(poorResult.providerAcquisition, null);
  assert.equal(richResult.prepareStatus, OfferPreparationConstants.STATUS.READY);
  assert.deepEqual(richResult.userContent, {
    text: buildRichText(),
    providedAt: FIRST_TIME,
  });
});

test("prepare rejects syntactically invalid and unknown ids", () => {
  const context = createContext(null);
  assert.throws(() => {
    return context.service.prepare(0);
  }, (error) => {
    return error.statusCode === HttpStatus.BAD_REQUEST;
  });
  assert.throws(() => {
    return context.service.prepare(OFFER_ID);
  }, (error) => {
    return error.statusCode === HttpStatus.NOT_FOUND;
  });
});

test("first user text creation stores the exact string and reevaluates immediately", () => {
  const context = createContext(createOffer());
  const text = ` ${buildRichText()} `;
  const result = context.service.replaceUserText(OFFER_ID, text);

  assert.equal(context.calls.replaceCount, 1);
  assert.equal(context.getOffer().offerContent.userText.value, text);
  assert.equal(context.getOffer().offerContent.userText.providedAt, FIRST_TIME);
  assert.equal(result.prepareStatus, OfferPreparationConstants.STATUS.READY);
  assert.equal(result.evaluation.metrics.textSource, OfferContentEvaluationConstants.TEXT_SOURCE.USER);
  assert.equal(result.userContent.text, text);
});

test("different user text replaces with a new timestamp while an exact repeat is a no-op", () => {
  const initialContent = new OfferContent({
    userText: { value: "Existing text", providedAt: FIRST_TIME },
  });
  const context = createContext(createOffer({ offerContent: initialContent }), [SECOND_TIME]);
  const noOp = context.service.replaceUserText(OFFER_ID, "Existing text");

  assert.equal(context.calls.replaceCount, 0);
  assert.equal(context.calls.nowCount, 0);
  assert.equal(noOp.userContent.providedAt, FIRST_TIME);

  const replaced = context.service.replaceUserText(OFFER_ID, " Existing text ");
  assert.equal(context.calls.replaceCount, 1);
  assert.equal(context.calls.nowCount, 1);
  assert.equal(replaced.userContent.text, " Existing text ");
  assert.equal(replaced.userContent.providedAt, SECOND_TIME);
});

test("user-text validation rejects empty, non-string and oversized values without writing", () => {
  const context = createContext(createOffer());
  const invalidValues = [
    null,
    undefined,
    1,
    "   ",
    "x".repeat(OfferContentLimits.MAXIMUM_TEXT_LENGTH + 1),
  ];

  for (const value of invalidValues) {
    assert.throws(() => {
      return context.service.replaceUserText(OFFER_ID, value);
    }, (error) => {
      return error.statusCode === HttpStatus.BAD_REQUEST;
    });
  }
  assert.equal(context.calls.findCount, 0);
  assert.equal(context.calls.replaceCount, 0);
});

test("maximum-length user text reaches business evaluation instead of being rejected", () => {
  const context = createContext(createOffer());
  const text = "x".repeat(OfferContentLimits.MAXIMUM_TEXT_LENGTH);
  const result = context.service.replaceUserText(OFFER_ID, text);

  assert.equal(context.calls.replaceCount, 1);
  assert.equal(result.evaluation.metrics.characterCount, OfferContentLimits.MAXIMUM_TEXT_LENGTH);
});
