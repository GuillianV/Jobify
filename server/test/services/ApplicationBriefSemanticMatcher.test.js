import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationBriefMatcherConstants } from "../../src/constants/ApplicationBriefMatcherConstants.js";
import { ApplicationBriefSemanticJsonSchema } from "../../src/constants/ApplicationBriefSemanticJsonSchema.js";
import { ApplicationBriefMatcherError } from "../../src/services/ApplicationBriefMatcherError.js";
import { ApplicationBriefPrompt } from "../../src/services/ApplicationBriefPrompt.js";
import { ApplicationBriefSemanticMatcher } from "../../src/services/ApplicationBriefSemanticMatcher.js";
import { ApplicationBriefSemanticOutputValidator } from "../../src/services/ApplicationBriefSemanticOutputValidator.js";
import { GroqJsonClientError } from "../../src/services/GroqJsonClientError.js";

const MODEL = "matcher-model";
const GPT_OSS_120B_MODEL = "openai/gpt-oss-120b";
const GPT_OSS_20B_MODEL = "openai/gpt-oss-20b";
const HISTORICAL_MODEL = "llama-3.3-70b-versatile";
const MAXIMUM_TECHNICAL_ATTEMPTS = 2;

/**
 * Build one valid empty semantic output.
 * @returns {object} Semantic output fixture.
 */
function createOutput() {
  return { requirementMatches: [], emphasis: [], supportedClaims: [], cautions: [] };
}

/**
 * Build a matcher with one injectable completion implementation.
 * @param {Function} completeJson - Fake completion implementation.
 * @param {object} [config] - Optional execution configuration.
 * @returns {ApplicationBriefSemanticMatcher} Matcher fixture.
 */
function createMatcher(completeJson, config = ApplicationBriefSemanticMatcher.buildConfig(MODEL)) {
  return new ApplicationBriefSemanticMatcher({
    promptBuilder: new ApplicationBriefPrompt(),
    groqClient: { completeJson },
    semanticValidator: new ApplicationBriefSemanticOutputValidator(),
    config,
  });
}

test("matcher sends only serialized projection with injected provider settings", async () => {
  const requests = [];
  const projection = {
    offer: { title: "Engineer", requirements: [] },
    candidate: { skills: [] },
  };
  const matcher = createMatcher(async (request) => {
    requests.push(structuredClone(request));
    return createOutput();
  });
  const result = await matcher.match(projection);

  assert.deepEqual(result, createOutput());
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, MODEL);
  assert.equal(requests[0].timeout, ApplicationBriefMatcherConstants.TIMEOUT_MS);
  assert.equal(requests[0].maxTokens, ApplicationBriefMatcherConstants.MAX_OUTPUT_TOKENS);
  assert.equal(Object.hasOwn(requests[0], "responseFormat"), false);
  assert.equal(Object.hasOwn(requests[0], "reasoningEffort"), false);
  assert.equal(requests[0].userPrompt.endsWith(JSON.stringify(projection)), true);
  assert.equal(requests[0].userPrompt.includes("offerIdentity"), false);
  assert.equal(requests[0].userPrompt.includes("fingerprint"), false);
});

test("known GPT-OSS models use strict semantic schema without reasoning", async () => {
  for (const model of [GPT_OSS_120B_MODEL, GPT_OSS_20B_MODEL]) {
    const requests = [];
    const matcher = createMatcher(async (request) => {
      requests.push(structuredClone(request));
      return createOutput();
    }, ApplicationBriefSemanticMatcher.buildConfig(model));
    await matcher.match({ offer: {}, candidate: {} });

    assert.equal(requests.length, 1);
    assert.deepEqual(
      requests[0].responseFormat,
      ApplicationBriefSemanticJsonSchema.createResponseFormat(),
    );
    assert.equal(Object.hasOwn(requests[0], "reasoningEffort"), false);
    assert.equal(requests[0].maxTokens, ApplicationBriefMatcherConstants.MAX_OUTPUT_TOKENS);
  }
});

test("unsupported model preserves the historical matcher request", async () => {
  const requests = [];
  const matcher = createMatcher(async (request) => {
    requests.push(structuredClone(request));
    return createOutput();
  }, ApplicationBriefSemanticMatcher.buildConfig(HISTORICAL_MODEL));
  await matcher.match({ offer: {}, candidate: {} });

  assert.equal(requests.length, 1);
  assert.equal(Object.hasOwn(requests[0], "responseFormat"), false);
  assert.equal(Object.hasOwn(requests[0], "reasoningEffort"), false);
  assert.equal(requests[0].maxTokens, ApplicationBriefMatcherConstants.MAX_OUTPUT_TOKENS);
});

test("input character budget accepts the exact limit and fails above without a call", async () => {
  const emptySerializedLength = JSON.stringify({ value: "" }).length;
  const exactProjection = {
    value: "x".repeat(ApplicationBriefMatcherConstants.MAX_INPUT_CHARACTERS
      - emptySerializedLength),
  };
  let calls = 0;
  const matcher = createMatcher(async () => {
    calls += 1;
    return createOutput();
  });
  await matcher.match(exactProjection);
  assert.equal(JSON.stringify(exactProjection).length,
    ApplicationBriefMatcherConstants.MAX_INPUT_CHARACTERS);
  assert.equal(calls, 1);

  const excessive = { value: `${exactProjection.value}x` };
  await assert.rejects(matcher.match(excessive), (error) => {
    assert.equal(error instanceof ApplicationBriefMatcherError, true);
    assert.equal(error.code, ApplicationBriefMatcherError.CODE.INPUT_TOO_LARGE);
    return true;
  });
  assert.equal(calls, 1);
});

test("invalid semantic output fails once without semantic retry", async () => {
  let calls = 0;
  const matcher = createMatcher(async () => {
    calls += 1;
    return { requirementMatches: [] };
  });
  await assert.rejects(matcher.match({ offer: {}, candidate: {} }), (error) => {
    assert.equal(error.code, ApplicationBriefMatcherError.CODE.INVALID_OUTPUT);
    assert.equal(error.reason, ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT);
    return true;
  });
  assert.equal(calls, 1);
});

test("strict transport output still passes through authoritative business validation", async () => {
  let calls = 0;
  const matcher = createMatcher(async () => {
    calls += 1;
    return {
      requirementMatches: [{
        offerRef: { kind: "REQUIREMENT", index: 0 },
        state: "SUPPORTED",
        supportedFacets: [],
        notEvidencedFacets: [],
      }],
      emphasis: [],
      supportedClaims: [],
      cautions: [],
    };
  }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL));
  await assert.rejects(matcher.match({ offer: {}, candidate: {} }), (error) => {
    assert.equal(error.code, ApplicationBriefMatcherError.CODE.INVALID_OUTPUT);
    assert.equal(
      error.safeDetails.validationSubcode,
      ApplicationBriefMatcherError.SEMANTIC_VALIDATION_SUBCODE.STATE_FACET_INVARIANT,
    );
    return true;
  });
  assert.equal(calls, 1);
});

test("recognized provider failures map to the closed matcher taxonomy", async () => {
  const mappings = [
    [GroqJsonClientError.CODE.UNAVAILABLE, ApplicationBriefMatcherError.CODE.UNAVAILABLE, null],
    [GroqJsonClientError.CODE.AUTHENTICATION_ERROR,
      ApplicationBriefMatcherError.CODE.UNAVAILABLE, null],
    [GroqJsonClientError.CODE.TIMEOUT, ApplicationBriefMatcherError.CODE.TIMEOUT, null],
    [GroqJsonClientError.CODE.RATE_LIMITED, ApplicationBriefMatcherError.CODE.RATE_LIMITED, null],
    [GroqJsonClientError.CODE.HTTP_ERROR, ApplicationBriefMatcherError.CODE.PROVIDER_ERROR, null],
    [GroqJsonClientError.CODE.INVALID_RESPONSE, ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
      ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT],
  ];
  for (const [transportCode, expectedCode, expectedReason] of mappings) {
    const original = new GroqJsonClientError(transportCode);
    const matcher = createMatcher(async () => {
      throw original;
    });
    await assert.rejects(matcher.match({ offer: {}, candidate: {} }), (error) => {
      assert.equal(error.code, expectedCode);
      assert.equal(error.reason, expectedReason);
      assert.equal(error.cause, original);
      return true;
    });
  }
});

test("one technical token retry preserves strict schema and can succeed", async () => {
  const requests = [];
  const matcher = createMatcher(async (request) => {
    requests.push(structuredClone(request));
    if (requests.length === 1) {
      throw new GroqJsonClientError(GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED, {
        limitTokens: 10000,
        requestedTokens: 11000,
      });
    }
    return createOutput();
  }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL));
  const result = await matcher.match({ offer: {}, candidate: {} });

  assert.deepEqual(result, createOutput());
  assert.equal(requests.length, MAXIMUM_TECHNICAL_ATTEMPTS);
  assert.equal(requests[1].systemPrompt, requests[0].systemPrompt);
  assert.equal(requests[1].userPrompt, requests[0].userPrompt);
  assert.equal(requests[1].maxTokens < requests[0].maxTokens, true);
  assert.deepEqual(requests[1].responseFormat, requests[0].responseFormat);
  assert.deepEqual(
    requests[0].responseFormat,
    ApplicationBriefSemanticJsonSchema.createResponseFormat(),
  );
  assert.equal(Object.hasOwn(requests[0], "reasoningEffort"), false);
  assert.equal(Object.hasOwn(requests[1], "reasoningEffort"), false);
});

test("unsupported model token retry keeps response format and reasoning absent", async () => {
  const requests = [];
  const matcher = createMatcher(async (request) => {
    requests.push(structuredClone(request));
    if (requests.length === 1) {
      throw new GroqJsonClientError(GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED, {
        limitTokens: 10000,
        requestedTokens: 11000,
      });
    }
    return createOutput();
  }, ApplicationBriefSemanticMatcher.buildConfig(HISTORICAL_MODEL));
  await matcher.match({ offer: {}, candidate: {} });

  assert.equal(requests.length, MAXIMUM_TECHNICAL_ATTEMPTS);
  for (const request of requests) {
    assert.equal(Object.hasOwn(request, "responseFormat"), false);
    assert.equal(Object.hasOwn(request, "reasoningEffort"), false);
  }
});

test("token retry never performs a third call and unsafe budgets stop immediately", async () => {
  let calls = 0;
  const retrying = createMatcher(async () => {
    calls += 1;
    throw new GroqJsonClientError(GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED, {
      limitTokens: 10000,
      requestedTokens: 11000,
    });
  });
  await assert.rejects(retrying.match({ offer: {}, candidate: {} }), (error) => {
    assert.equal(error.code, ApplicationBriefMatcherError.CODE.PROVIDER_TOKEN_BUDGET);
    return true;
  });
  assert.equal(calls, MAXIMUM_TECHNICAL_ATTEMPTS);

  calls = 0;
  const unsafe = createMatcher(async () => {
    calls += 1;
    throw new GroqJsonClientError(GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED, {});
  });
  await assert.rejects(unsafe.match({ offer: {}, candidate: {} }), (error) => {
    assert.equal(error.code, ApplicationBriefMatcherError.CODE.PROVIDER_TOKEN_BUDGET);
    return true;
  });
  assert.equal(calls, 1);
});
