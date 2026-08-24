import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationBriefLimits } from "../../src/constants/ApplicationBriefLimits.js";
import { ApplicationBriefMatcherConstants } from "../../src/constants/ApplicationBriefMatcherConstants.js";
import { ApplicationBriefMatcherError } from "../../src/services/ApplicationBriefMatcherError.js";
import { ApplicationBriefPrompt } from "../../src/services/ApplicationBriefPrompt.js";
import { ApplicationBriefSemanticMatcher } from "../../src/services/ApplicationBriefSemanticMatcher.js";
import { ApplicationBriefSemanticOutputValidator } from "../../src/services/ApplicationBriefSemanticOutputValidator.js";
import { GroqJsonClientError } from "../../src/services/GroqJsonClientError.js";

const MODEL = "matcher-model";
const GPT_OSS_120B_MODEL = "openai/gpt-oss-120b";
const GPT_OSS_20B_MODEL = "openai/gpt-oss-20b";
const HISTORICAL_MODEL = "llama-3.3-70b-versatile";
const JSON_OBJECT_RESPONSE_FORMAT = Object.freeze({ type: "json_object" });
const MAXIMUM_TECHNICAL_ATTEMPTS = 2;
const MAXIMUM_CROSS_CLASS_ATTEMPTS = 3;
const EXPECTED_RETRY_MAX_TOKENS = 3095;
const EXPECTED_RETRY_TOKEN_BUDGET = 9999;
const HTTP_BAD_REQUEST = 400;
const HTTP_CONTENT_TOO_LARGE = 413;
const PROVIDER_SUCCESS_EVENT = "application_brief_semantic_matcher_provider_success";
const NULL_RATE_LIMIT_DETAILS = Object.freeze({
  rateLimitTokenLimit: null,
  rateLimitTokenRemaining: null,
  rateLimitTokenResetMs: null,
  rateLimitRequestLimit: null,
  rateLimitRequestRemaining: null,
  rateLimitRequestResetMs: null,
  retryAfterMs: null,
});
const RATE_LIMIT_DETAILS_A = Object.freeze({
  rateLimitTokenLimit: 12000,
  rateLimitTokenRemaining: 8000,
  rateLimitTokenResetMs: 1500,
  rateLimitRequestLimit: 100,
  rateLimitRequestRemaining: 80,
  rateLimitRequestResetMs: 2500,
  retryAfterMs: 3000,
});
const RATE_LIMIT_DETAILS_B = Object.freeze({
  rateLimitTokenLimit: 22000,
  rateLimitTokenRemaining: 17000,
  rateLimitTokenResetMs: 3500,
  rateLimitRequestLimit: 200,
  rateLimitRequestRemaining: 60,
  rateLimitRequestResetMs: 4500,
  retryAfterMs: 5000,
});

/**
 * Build one valid empty semantic output.
 * @returns {object} Semantic output fixture.
 */
function createOutput() {
  return { requirementMatches: [], emphasis: [], supportedClaims: [], cautions: [] };
}

/**
 * Build the exact closed provider-success size diagnostic.
 * @param {number} attempt - Successful provider attempt.
 * @param {number} maxTokens - Exact completion cap used by the attempt.
 * @param {object} [output] - Parsed semantic output.
 * @returns {object} Expected safe event.
 */
function createProviderSuccessEvent(attempt, maxTokens, output = createOutput()) {
  return {
    event: PROVIDER_SUCCESS_EVENT,
    attempt,
    maxTokens,
    semanticOutputJsonCharacters: JSON.stringify(output).length,
  };
}

/**
 * Build a matcher with one injectable completion implementation.
 * @param {Function} completeJson - Fake completion implementation.
 * @param {object} [config] - Optional execution configuration.
 * @returns {ApplicationBriefSemanticMatcher} Matcher fixture.
 */
function createMatcher(
  completeJson,
  config = ApplicationBriefSemanticMatcher.buildConfig(MODEL),
  logger = { warn() {} },
  safeRateLimitDetails = {},
) {
  return new ApplicationBriefSemanticMatcher({
    promptBuilder: new ApplicationBriefPrompt(),
    groqClient: {
      async completeJsonWithMetadata(request) {
        return {
          value: await completeJson(request),
          safeRateLimitDetails: structuredClone(safeRateLimitDetails),
        };
      },
    },
    semanticValidator: new ApplicationBriefSemanticOutputValidator(),
    config,
    logger,
  });
}

/**
 * Build the exact transient structured-output provider failure.
 * @param {object} [safeDetails] - Optional typed rate-limit details.
 * @returns {GroqJsonClientError} Targeted safe provider error.
 */
function createJsonValidationError(safeDetails = {}) {
  return new GroqJsonClientError(GroqJsonClientError.CODE.HTTP_ERROR, {
    status: HTTP_BAD_REQUEST,
    providerType: "invalid_request_error",
    providerCode: "json_validate_failed",
    ...safeDetails,
  });
}

/**
 * Build one recognized token-budget error with optional header-derived metadata.
 * @param {object} [safeDetails] - Optional typed rate-limit details.
 * @returns {GroqJsonClientError} Recognized token-budget error.
 */
function createTokenBudgetError(safeDetails = {}) {
  return new GroqJsonClientError(GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED, {
    limitTokens: 10000,
    requestedTokens: 11000,
    ...safeDetails,
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

test("matcher detailed success retains one call actual budget and safe metadata", async () => {
  const matcher = createMatcher(async () => {
    return createOutput();
  }, ApplicationBriefSemanticMatcher.buildConfig(MODEL), { warn() {} }, RATE_LIMIT_DETAILS_A);

  const result = await matcher.matchWithExecution({ offer: {}, candidate: {} });

  assert.deepEqual(result, {
    semanticOutput: createOutput(),
    providerExecution: {
      providerCallsMade: 1,
      successfulMaxTokens: ApplicationBriefMatcherConstants.MAX_OUTPUT_TOKENS,
      ...RATE_LIMIT_DETAILS_A,
    },
  });
  assert.equal(Object.hasOwn(
    result.providerExecution,
    "successfulRequestTokenBudget",
  ), false);
});

test("matcher detailed success retains reduced budget after recognized 413", async () => {
  let calls = 0;
  const matcher = createMatcher(async () => {
    calls += 1;
    if (calls === 1) {
      throw createTokenBudgetError();
    }
    return createOutput();
  }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL), {
    warn() {},
  }, RATE_LIMIT_DETAILS_B);

  const result = await matcher.matchWithExecution({ offer: {}, candidate: {} });

  assert.equal(result.providerExecution.providerCallsMade, MAXIMUM_TECHNICAL_ATTEMPTS);
  assert.equal(result.providerExecution.successfulMaxTokens, EXPECTED_RETRY_MAX_TOKENS);
  assert.deepEqual(
    result.providerExecution,
    {
      providerCallsMade: MAXIMUM_TECHNICAL_ATTEMPTS,
      successfulMaxTokens: EXPECTED_RETRY_MAX_TOKENS,
      successfulRequestTokenBudget: EXPECTED_RETRY_TOKEN_BUDGET,
      ...RATE_LIMIT_DETAILS_B,
    },
  );
});

test("matcher detailed success counts json validation retry at the actual budget", async () => {
  let calls = 0;
  const matcher = createMatcher(async () => {
    calls += 1;
    if (calls === 1) {
      throw createJsonValidationError();
    }
    return createOutput();
  }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL));

  const result = await matcher.matchWithExecution({ offer: {}, candidate: {} });

  assert.deepEqual(result.providerExecution, {
    providerCallsMade: MAXIMUM_TECHNICAL_ATTEMPTS,
    successfulMaxTokens: ApplicationBriefMatcherConstants.MAX_OUTPUT_TOKENS,
  });
  assert.equal(Object.hasOwn(
    result.providerExecution,
    "successfulRequestTokenBudget",
  ), false);
});

test("matcher detailed success counts special Attempt 3 without resetting reduced budget", async () => {
  let calls = 0;
  const matcher = createMatcher(async () => {
    calls += 1;
    if (calls === 1) {
      throw createTokenBudgetError();
    }
    if (calls === MAXIMUM_TECHNICAL_ATTEMPTS) {
      throw createJsonValidationError();
    }
    return createOutput();
  }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL));

  const result = await matcher.matchWithExecution({ offer: {}, candidate: {} });

  assert.equal(calls, MAXIMUM_CROSS_CLASS_ATTEMPTS);
  assert.deepEqual(result.providerExecution, {
    providerCallsMade: MAXIMUM_CROSS_CLASS_ATTEMPTS,
    successfulMaxTokens: EXPECTED_RETRY_MAX_TOKENS,
    successfulRequestTokenBudget: EXPECTED_RETRY_TOKEN_BUDGET,
  });
});

test("known GPT-OSS models use json object with otherwise unchanged settings", async () => {
  for (const model of [GPT_OSS_120B_MODEL, GPT_OSS_20B_MODEL]) {
    const requests = [];
    const matcher = createMatcher(async (request) => {
      requests.push(structuredClone(request));
      return createOutput();
    }, ApplicationBriefSemanticMatcher.buildConfig(model));
    await matcher.match({ offer: {}, candidate: {} });

    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].responseFormat, JSON_OBJECT_RESPONSE_FORMAT);
    assert.equal(Object.hasOwn(requests[0], "reasoningEffort"), true);
    assert.equal(requests[0].reasoningEffort, "low");
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
  const logs = [];
  const output = { requirementMatches: [] };
  const matcher = createMatcher(async () => {
    calls += 1;
    return output;
  }, ApplicationBriefSemanticMatcher.buildConfig(MODEL), {
    warn(value) {
      logs.push(value);
    },
  });
  await assert.rejects(matcher.match({ offer: {}, candidate: {} }), (error) => {
    assert.equal(error.code, ApplicationBriefMatcherError.CODE.INVALID_OUTPUT);
    assert.equal(error.reason, ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT);
    return true;
  });
  assert.equal(calls, 1);
  assert.deepEqual(logs.map(JSON.parse), [createProviderSuccessEvent(
    1,
    ApplicationBriefMatcherConstants.MAX_OUTPUT_TOKENS,
    output,
  )]);
});

test("parseable cardinality failure emits provider success and never retries", async () => {
  let calls = 0;
  const logs = [];
  const output = createOutput();
  output.emphasis = Array(ApplicationBriefLimits.MAX_EMPHASIS + 1).fill(null);
  const matcher = createMatcher(async () => {
    calls += 1;
    return output;
  }, ApplicationBriefSemanticMatcher.buildConfig(MODEL), {
    warn(value) {
      logs.push(value);
    },
  });

  await assert.rejects(matcher.match({ offer: {}, candidate: {} }), (error) => {
    assert.equal(error.code, ApplicationBriefMatcherError.CODE.INVALID_OUTPUT);
    assert.equal(error.reason, ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT);
    assert.deepEqual(error.safeDetails, {
      validationCode: "SEMANTIC_VALIDATION",
      validationSubcode: "CARDINALITY",
      cardinalityRule: "ROOT_EMPHASIS_MAX",
    });
    return true;
  });
  assert.equal(calls, 1);
  assert.deepEqual(logs.map(JSON.parse), [createProviderSuccessEvent(
    1,
    ApplicationBriefMatcherConstants.MAX_OUTPUT_TOKENS,
    output,
  )]);
});

test("parseable nested-shape failure emits provider success and never retries", async () => {
  let calls = 0;
  const logs = [];
  const output = createOutput();
  output.supportedClaims = [{
    claimType: "EXPERIENCE_FACT",
    offerRefs: [{ kind: "REQUIREMENT", index: 0 }],
    evidenceRefs: [{ kind: "EXPERIENCE", itemId: "experience-1", field: "role" }],
    unknown: true,
  }];
  const matcher = createMatcher(async () => {
    calls += 1;
    return output;
  }, ApplicationBriefSemanticMatcher.buildConfig(MODEL), {
    warn(value) {
      logs.push(value);
    },
  });

  await assert.rejects(matcher.match({ offer: {}, candidate: {} }), (error) => {
    assert.equal(error.code, ApplicationBriefMatcherError.CODE.INVALID_OUTPUT);
    assert.equal(error.reason, ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT);
    assert.deepEqual(error.safeDetails, {
      validationCode: "SEMANTIC_VALIDATION",
      validationSubcode: "NESTED_SHAPE_OR_KEYS",
      nestedShapeRule: "SUPPORTED_CLAIM_SHAPE",
    });
    return true;
  });
  assert.equal(calls, 1);
  assert.deepEqual(logs.map(JSON.parse), [createProviderSuccessEvent(
    1,
    ApplicationBriefMatcherConstants.MAX_OUTPUT_TOKENS,
    output,
  )]);
});

test("json object transport output still passes through authoritative business validation", async () => {
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

test("json object contract violations are rejected locally without retry", async () => {
  const unknownEnum = createOutput();
  unknownEnum.requirementMatches = [{
    offerRef: { kind: "REQUIREMENT", index: 0 },
    state: "UNKNOWN",
    supportedFacets: [],
    notEvidencedFacets: [{ text: "Requirement" }],
  }];
  const missingRootKey = createOutput();
  delete missingRootKey.cautions;
  const unknownRootKey = { ...createOutput(), unknown: true };
  const cases = [
    [unknownEnum, ApplicationBriefMatcherError.SEMANTIC_VALIDATION_SUBCODE.ENUM],
    [missingRootKey, ApplicationBriefMatcherError.SEMANTIC_VALIDATION_SUBCODE.ROOT_SHAPE_OR_KEYS],
    [unknownRootKey, ApplicationBriefMatcherError.SEMANTIC_VALIDATION_SUBCODE.ROOT_SHAPE_OR_KEYS],
  ];

  for (const [output, validationSubcode] of cases) {
    let calls = 0;
    const logs = [];
    const matcher = createMatcher(async () => {
      calls += 1;
      return output;
    }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL), {
      warn(value) {
        logs.push(value);
      },
    });

    await assert.rejects(matcher.match({ offer: {}, candidate: {} }), (error) => {
      assert.equal(error.code, ApplicationBriefMatcherError.CODE.INVALID_OUTPUT);
      assert.equal(error.reason, ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT);
      assert.equal(error.safeDetails.validationSubcode, validationSubcode);
      return true;
    });
    assert.equal(calls, 1);
    assert.deepEqual(logs.map(JSON.parse), [createProviderSuccessEvent(
      1,
      ApplicationBriefMatcherConstants.MAX_OUTPUT_TOKENS,
      output,
    )]);
  }
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

test("initial provider success emits size observability while rate limit emits nothing", async () => {
  for (const outcome of [createOutput(), new GroqJsonClientError(GroqJsonClientError.CODE.RATE_LIMITED)]) {
    const logs = [];
    let calls = 0;
    const matcher = createMatcher(async () => {
      calls += 1;
      if (outcome instanceof Error) {
        throw outcome;
      }
      return outcome;
    }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL), {
      warn(value) {
        logs.push(value);
      },
    });
    if (outcome instanceof Error) {
      await assert.rejects(matcher.match({ offer: {}, candidate: {} }));
    } else {
      assert.deepEqual(await matcher.match({ offer: {}, candidate: {} }), createOutput());
    }
    assert.equal(calls, 1);
    const expected = outcome instanceof Error ? [] : [createProviderSuccessEvent(
      1,
      ApplicationBriefMatcherConstants.MAX_OUTPUT_TOKENS,
    )];
    assert.deepEqual(logs.map(JSON.parse), expected);
  }
});

test("provider-success diagnostic is closed and logger failure remains non-fatal", async () => {
  const logs = [];
  const output = createOutput();
  const matcher = createMatcher(async () => {
    return output;
  }, ApplicationBriefSemanticMatcher.buildConfig(MODEL), {
    warn(value) {
      logs.push(value);
    },
  });

  assert.deepEqual(await matcher.match({ offer: {}, candidate: {} }), output);
  const event = JSON.parse(logs[0]);
  assert.deepEqual(Object.keys(event), [
    "event", "attempt", "maxTokens", "semanticOutputJsonCharacters",
  ]);
  assert.deepEqual(event, createProviderSuccessEvent(
    1,
    ApplicationBriefMatcherConstants.MAX_OUTPUT_TOKENS,
    output,
  ));
  for (const forbidden of [
    "requirementMatches", "systemPrompt", "userPrompt", "providerPromptTokens",
    "providerCompletionTokens", "providerTotalTokens", "usage", "choices",
  ]) {
    assert.equal(logs[0].includes(forbidden), false, forbidden);
  }

  const failingLoggerMatcher = createMatcher(async () => {
    return output;
  }, ApplicationBriefSemanticMatcher.buildConfig(MODEL), {
    warn() {
      throw new Error("logger failure");
    },
  });
  assert.deepEqual(
    await failingLoggerMatcher.match({ offer: {}, candidate: {} }),
    output,
  );
});

test("provider-success serialization failure is omitted without masking validation", async () => {
  const logs = [];
  const output = createOutput();
  output.cautions = output;
  const matcher = createMatcher(async () => {
    return output;
  }, ApplicationBriefSemanticMatcher.buildConfig(MODEL), {
    warn(value) {
      logs.push(value);
    },
  });

  await assert.rejects(matcher.match({ offer: {}, candidate: {} }), (error) => {
    assert.equal(error.code, ApplicationBriefMatcherError.CODE.INVALID_OUTPUT);
    assert.equal(error.reason, ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT);
    return true;
  });
  assert.deepEqual(logs, []);
});

test("120B retries exact json validation failure once with an identical request", async () => {
  const requests = [];
  const logs = [];
  const matcher = createMatcher(async (request) => {
    requests.push(structuredClone(request));
    if (requests.length === 1) {
      throw createJsonValidationError();
    }
    return createOutput();
  }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL), {
    warn(value) {
      logs.push(value);
    },
  });

  assert.deepEqual(await matcher.match({ offer: {}, candidate: {} }), createOutput());
  assert.equal(requests.length, MAXIMUM_TECHNICAL_ATTEMPTS);
  assert.deepEqual(requests[1], requests[0]);
  assert.deepEqual(logs.map(JSON.parse), [{
    event: "application_brief_semantic_matcher_retry",
    attempt: MAXIMUM_TECHNICAL_ATTEMPTS,
    status: HTTP_BAD_REQUEST,
    providerType: "invalid_request_error",
    providerCode: "json_validate_failed",
    ...NULL_RATE_LIMIT_DETAILS,
  }, createProviderSuccessEvent(
    MAXIMUM_TECHNICAL_ATTEMPTS,
    ApplicationBriefMatcherConstants.MAX_OUTPUT_TOKENS,
  )]);
  assert.equal(logs[0].includes("systemPrompt"), false);
  assert.equal(logs[0].includes("userPrompt"), false);
});

test("120B maps the second json validation failure without a third call", async () => {
  let calls = 0;
  const matcher = createMatcher(async () => {
    calls += 1;
    throw createJsonValidationError();
  }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL));

  await assert.rejects(matcher.match({ offer: {}, candidate: {} }), (error) => {
    assert.equal(error.code, ApplicationBriefMatcherError.CODE.PROVIDER_ERROR);
    return true;
  });
  assert.equal(calls, MAXIMUM_TECHNICAL_ATTEMPTS);
});

test("120B preserves the second rate-limit classification without a third call", async () => {
  let calls = 0;
  const matcher = createMatcher(async () => {
    calls += 1;
    if (calls === 1) {
      throw createJsonValidationError();
    }
    throw new GroqJsonClientError(GroqJsonClientError.CODE.RATE_LIMITED);
  }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL));

  await assert.rejects(matcher.match({ offer: {}, candidate: {} }), (error) => {
    assert.equal(error.code, ApplicationBriefMatcherError.CODE.RATE_LIMITED);
    return true;
  });
  assert.equal(calls, MAXIMUM_TECHNICAL_ATTEMPTS);
});

test("json validation retry never turns a second token-budget failure into a third call", async () => {
  let calls = 0;
  const matcher = createMatcher(async () => {
    calls += 1;
    if (calls === 1) {
      throw createJsonValidationError();
    }
    throw new GroqJsonClientError(GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED, {
      limitTokens: 10000,
      requestedTokens: 11000,
    });
  }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL));

  await assert.rejects(matcher.match({ offer: {}, candidate: {} }), (error) => {
    assert.equal(error.code, ApplicationBriefMatcherError.CODE.PROVIDER_TOKEN_BUDGET);
    return true;
  });
  assert.equal(calls, MAXIMUM_TECHNICAL_ATTEMPTS);
});

test("non-120B and non-target provider failures never use the targeted retry", async () => {
  for (const [model, error] of [
    [GPT_OSS_20B_MODEL, createJsonValidationError()],
    [HISTORICAL_MODEL, createJsonValidationError()],
    [GPT_OSS_120B_MODEL, new GroqJsonClientError(GroqJsonClientError.CODE.RATE_LIMITED)],
    [GPT_OSS_120B_MODEL, new GroqJsonClientError(GroqJsonClientError.CODE.TIMEOUT)],
    [GPT_OSS_120B_MODEL, new GroqJsonClientError(GroqJsonClientError.CODE.UNAVAILABLE)],
    [GPT_OSS_120B_MODEL, new GroqJsonClientError(GroqJsonClientError.CODE.INVALID_RESPONSE)],
    [GPT_OSS_120B_MODEL, new GroqJsonClientError(GroqJsonClientError.CODE.HTTP_ERROR, {
      status: HTTP_BAD_REQUEST,
      providerType: "invalid_request_error",
      providerCode: "another_code",
    })],
  ]) {
    let calls = 0;
    const matcher = createMatcher(async () => {
      calls += 1;
      throw error;
    }, ApplicationBriefSemanticMatcher.buildConfig(model));
    await assert.rejects(matcher.match({ offer: {}, candidate: {} }));
    assert.equal(calls, 1);
  }
});

test("one technical token retry preserves json object and low reasoning", async () => {
  for (const model of [GPT_OSS_120B_MODEL, GPT_OSS_20B_MODEL]) {
    const requests = [];
    const logs = [];
    const matcher = createMatcher(async (request) => {
      requests.push(structuredClone(request));
      if (requests.length === 1) {
        throw new GroqJsonClientError(GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED, {
          limitTokens: 10000,
          requestedTokens: 11000,
          message: "private provider message",
          failed_generation: "private raw output",
        });
      }
      return createOutput();
    }, ApplicationBriefSemanticMatcher.buildConfig(model), {
      warn(value) {
        logs.push(value);
      },
    });
    const result = await matcher.match({ offer: {}, candidate: {} });

    assert.deepEqual(result, createOutput());
    assert.equal(requests.length, MAXIMUM_TECHNICAL_ATTEMPTS);
    assert.equal(requests[1].systemPrompt, requests[0].systemPrompt);
    assert.equal(requests[1].userPrompt, requests[0].userPrompt);
    assert.equal(requests[0].maxTokens, ApplicationBriefMatcherConstants.MAX_OUTPUT_TOKENS);
    assert.equal(requests[1].maxTokens, EXPECTED_RETRY_MAX_TOKENS);
    assert.deepEqual(requests[1].responseFormat, requests[0].responseFormat);
    assert.deepEqual(requests[0].responseFormat, JSON_OBJECT_RESPONSE_FORMAT);
    assert.equal(requests[0].reasoningEffort, "low");
    assert.equal(requests[1].reasoningEffort, "low");
    assert.deepEqual(logs.map(JSON.parse), [{
      event: "application_brief_semantic_matcher_retry",
      nextAttempt: MAXIMUM_TECHNICAL_ATTEMPTS,
      retryReason: "TOKEN_BUDGET_413",
      status: HTTP_CONTENT_TOO_LARGE,
      providerType: "tokens",
      providerCode: "rate_limit_exceeded",
      limitTokens: 10000,
      requestedTokens: 11000,
      nextMaxTokens: EXPECTED_RETRY_MAX_TOKENS,
      ...NULL_RATE_LIMIT_DETAILS,
    }, createProviderSuccessEvent(
      MAXIMUM_TECHNICAL_ATTEMPTS,
      EXPECTED_RETRY_MAX_TOKENS,
    )]);
    for (const forbidden of [
      "private provider message",
      "private raw output",
      "systemPrompt",
      "userPrompt",
      "candidate",
      "offer",
      "failed_generation",
    ]) {
      assert.equal(logs[0].includes(forbidden), false);
    }
  }
});

test("token retry retains final non-json failures without a third call", async () => {
  for (const [secondError, expectedCode] of [
    [new GroqJsonClientError(GroqJsonClientError.CODE.RATE_LIMITED),
      ApplicationBriefMatcherError.CODE.RATE_LIMITED],
    [new GroqJsonClientError(GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED),
      ApplicationBriefMatcherError.CODE.PROVIDER_TOKEN_BUDGET],
    [new GroqJsonClientError(GroqJsonClientError.CODE.TIMEOUT),
      ApplicationBriefMatcherError.CODE.TIMEOUT],
    [new GroqJsonClientError(GroqJsonClientError.CODE.UNAVAILABLE),
      ApplicationBriefMatcherError.CODE.UNAVAILABLE],
  ]) {
    const logs = [];
    let calls = 0;
    const matcher = createMatcher(async () => {
      calls += 1;
      if (calls === 1) {
        throw new GroqJsonClientError(GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED, {
          limitTokens: 10000,
          requestedTokens: 11000,
        });
      }
      throw secondError;
    }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL), {
      warn(value) {
        logs.push(value);
      },
    });

    await assert.rejects(matcher.match({ offer: {}, candidate: {} }), (error) => {
      assert.equal(error.code, expectedCode);
      return true;
    });
    assert.equal(calls, MAXIMUM_TECHNICAL_ATTEMPTS);
    assert.equal(logs.length, 1);
    assert.equal(JSON.parse(logs[0]).retryReason, "TOKEN_BUDGET_413");
  }
});

test("120B cross-class recovery reuses the exact reduced request and succeeds", async () => {
  const requests = [];
  const logs = [];
  const matcher = createMatcher(async (request) => {
    requests.push(structuredClone(request));
    if (requests.length === 1) {
      throw new GroqJsonClientError(GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED, {
        limitTokens: 10000,
        requestedTokens: 11000,
      });
    }
    if (requests.length === MAXIMUM_TECHNICAL_ATTEMPTS) {
      throw createJsonValidationError();
    }
    return createOutput();
  }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL), {
    warn(value) {
      logs.push(value);
    },
  });

  assert.deepEqual(await matcher.match({ offer: {}, candidate: {} }), createOutput());
  assert.equal(requests.length, MAXIMUM_CROSS_CLASS_ATTEMPTS);
  assert.equal(requests[0].maxTokens, ApplicationBriefMatcherConstants.MAX_OUTPUT_TOKENS);
  assert.equal(requests[1].maxTokens, EXPECTED_RETRY_MAX_TOKENS);
  assert.deepEqual(requests[2], requests[1]);
  assert.deepEqual(logs.map(JSON.parse), [{
    event: "application_brief_semantic_matcher_retry",
    nextAttempt: MAXIMUM_TECHNICAL_ATTEMPTS,
    retryReason: "TOKEN_BUDGET_413",
    status: HTTP_CONTENT_TOO_LARGE,
    providerType: "tokens",
    providerCode: "rate_limit_exceeded",
    limitTokens: 10000,
    requestedTokens: 11000,
    nextMaxTokens: EXPECTED_RETRY_MAX_TOKENS,
    ...NULL_RATE_LIMIT_DETAILS,
  }, {
    event: "application_brief_semantic_matcher_retry",
    nextAttempt: MAXIMUM_CROSS_CLASS_ATTEMPTS,
    retryReason: "JSON_VALIDATE_FAILED_AFTER_TOKEN_BUDGET_413",
    status: HTTP_BAD_REQUEST,
    providerType: "invalid_request_error",
    providerCode: "json_validate_failed",
    nextMaxTokens: EXPECTED_RETRY_MAX_TOKENS,
    ...NULL_RATE_LIMIT_DETAILS,
  }, createProviderSuccessEvent(
    MAXIMUM_CROSS_CLASS_ATTEMPTS,
    EXPECTED_RETRY_MAX_TOKENS,
  )]);
  for (const log of logs) {
    for (const forbidden of [
      "systemPrompt", "userPrompt", "candidate", "offer", "failed_generation",
    ]) {
      assert.equal(log.includes(forbidden), false);
    }
  }
});

test("insufficient Attempt-2 token headroom skips the final cross-class call locally", async () => {
  const logs = [];
  let calls = 0;
  const matcher = createMatcher(async () => {
    calls += 1;
    if (calls === 1) {
      throw createTokenBudgetError({
        rateLimitTokenRemaining: RATE_LIMIT_DETAILS_A.rateLimitTokenRemaining,
      });
    }
    throw createJsonValidationError({
      rateLimitTokenRemaining: 1,
      rateLimitTokenResetMs: RATE_LIMIT_DETAILS_B.rateLimitTokenResetMs,
      retryAfterMs: RATE_LIMIT_DETAILS_B.retryAfterMs,
      message: "private provider message",
      rawHeaders: { authorization: "private authorization" },
      failed_generation: "private raw output",
    });
  }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL), {
    warn(value) {
      logs.push(value);
    },
  });

  await assert.rejects(matcher.match({ offer: {}, candidate: {} }), (error) => {
    assert.equal(error.code, ApplicationBriefMatcherError.CODE.RATE_LIMITED);
    assert.equal(
      error.reason,
      ApplicationBriefMatcherError.REASON.RATE_LIMIT_HEADROOM_SKIP,
    );
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(calls, MAXIMUM_TECHNICAL_ATTEMPTS);
  const events = logs.map(JSON.parse);
  assert.equal(events.length, MAXIMUM_TECHNICAL_ATTEMPTS);
  assert.equal(events[0].retryReason, "TOKEN_BUDGET_413");
  assert.deepEqual(events[1], {
    event: "application_brief_semantic_matcher_cross_class_skip",
    nextAttempt: MAXIMUM_CROSS_CLASS_ATTEMPTS,
    decision: "CROSS_CLASS_RETRY_SKIPPED_TOKEN_HEADROOM",
    rateLimitTokenRemaining: 1,
    requiredTokenBudget: EXPECTED_RETRY_TOKEN_BUDGET,
  });
  assert.equal(events.some((event) => {
    return event.retryReason === "JSON_VALIDATE_FAILED_AFTER_TOKEN_BUDGET_413";
  }), false);
  const serialized = JSON.stringify(events[1]);
  for (const forbidden of [
    "message", "private", "rawHeaders", "authorization", "failed_generation",
    "rateLimitTokenResetMs", "retryAfterMs",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("cross-class skip uses only Attempt-2 headroom and preserves sufficient fallback", async () => {
  for (const remaining of [EXPECTED_RETRY_TOKEN_BUDGET, RATE_LIMIT_DETAILS_B.rateLimitTokenRemaining]) {
    let calls = 0;
    const requests = [];
    const matcher = createMatcher(async (request) => {
      calls += 1;
      requests.push(structuredClone(request));
      if (calls === 1) {
        throw createTokenBudgetError({ rateLimitTokenRemaining: 0 });
      }
      if (calls === MAXIMUM_TECHNICAL_ATTEMPTS) {
        throw createJsonValidationError({
          rateLimitTokenRemaining: remaining,
          rateLimitRequestRemaining: 0,
        });
      }
      return createOutput();
    }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL));

    assert.deepEqual(await matcher.match({ offer: {}, candidate: {} }), createOutput());
    assert.equal(calls, MAXIMUM_CROSS_CLASS_ATTEMPTS);
    assert.deepEqual(requests[2], requests[1]);
  }
});

test("Attempt-2 zero headroom skips despite sufficient Attempt-1 metadata", async () => {
  let calls = 0;
  const matcher = createMatcher(async () => {
    calls += 1;
    if (calls === 1) {
      throw createTokenBudgetError({
        rateLimitTokenRemaining: RATE_LIMIT_DETAILS_B.rateLimitTokenRemaining,
      });
    }
    throw createJsonValidationError({ rateLimitTokenRemaining: 0 });
  }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL));

  await assert.rejects(matcher.match({ offer: {}, candidate: {} }), (error) => {
    assert.equal(error.code, ApplicationBriefMatcherError.CODE.RATE_LIMITED);
    return true;
  });
  assert.equal(calls, MAXIMUM_TECHNICAL_ATTEMPTS);
});

test("missing or invalid Attempt-2 token headroom preserves the final call", async () => {
  for (const safeDetails of [{}, { rateLimitTokenRemaining: null }, {
    rateLimitTokenRemaining: "1",
  }, { rateLimitTokenRemaining: Number.MAX_SAFE_INTEGER + 1 }]) {
    let calls = 0;
    const matcher = createMatcher(async () => {
      calls += 1;
      if (calls === 1) {
        throw createTokenBudgetError();
      }
      if (calls === MAXIMUM_TECHNICAL_ATTEMPTS) {
        throw createJsonValidationError(safeDetails);
      }
      return createOutput();
    }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL));

    assert.deepEqual(await matcher.match({ offer: {}, candidate: {} }), createOutput());
    assert.equal(calls, MAXIMUM_CROSS_CLASS_ATTEMPTS);
  }
});

test("required retry budget is derived from 413 metrics and invalid budgets fail open", () => {
  const matcher = createMatcher(async () => {
    return createOutput();
  }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL));
  const tokenError = createTokenBudgetError();

  assert.equal(matcher.calculateExpectedRetryTokenBudget(
    tokenError,
    ApplicationBriefMatcherConstants.MAX_OUTPUT_TOKENS,
    EXPECTED_RETRY_MAX_TOKENS,
  ), EXPECTED_RETRY_TOKEN_BUDGET);
  for (const values of [
    [tokenError, Number.NaN, EXPECTED_RETRY_MAX_TOKENS],
    [tokenError, ApplicationBriefMatcherConstants.MAX_OUTPUT_TOKENS, Number.NaN],
    [new GroqJsonClientError(GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED),
      ApplicationBriefMatcherConstants.MAX_OUTPUT_TOKENS, EXPECTED_RETRY_MAX_TOKENS],
  ]) {
    assert.equal(matcher.calculateExpectedRetryTokenBudget(...values), null);
  }
  assert.equal(matcher.shouldSkipCrossClassRetry(
    createJsonValidationError({ rateLimitTokenRemaining: 0 }),
    null,
  ), false);
});

test("retry diagnostics preserve per-attempt rate-limit provenance and closed fields", async () => {
  const logs = [];
  let calls = 0;
  const matcher = createMatcher(async () => {
    calls += 1;
    if (calls === 1) {
      throw new GroqJsonClientError(GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED, {
        limitTokens: 10000,
        requestedTokens: 11000,
        rateLimitTokenLimit: RATE_LIMIT_DETAILS_A.rateLimitTokenLimit,
        ...RATE_LIMIT_DETAILS_A,
        unknown: "private unknown",
        message: "private provider message",
        headers: { authorization: "private authorization" },
        failed_generation: "private raw output",
      });
    }
    if (calls === MAXIMUM_TECHNICAL_ATTEMPTS) {
      throw createJsonValidationError(RATE_LIMIT_DETAILS_B);
    }
    return createOutput();
  }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL), {
    warn(value) {
      logs.push(value);
    },
  });

  await matcher.match({ offer: {}, candidate: {} });
  const events = logs.map(JSON.parse);
  assert.equal(calls, MAXIMUM_CROSS_CLASS_ATTEMPTS);
  assert.deepEqual(events[0], {
    event: "application_brief_semantic_matcher_retry",
    nextAttempt: MAXIMUM_TECHNICAL_ATTEMPTS,
    retryReason: "TOKEN_BUDGET_413",
    status: HTTP_CONTENT_TOO_LARGE,
    providerType: "tokens",
    providerCode: "rate_limit_exceeded",
    limitTokens: 10000,
    requestedTokens: 11000,
    nextMaxTokens: EXPECTED_RETRY_MAX_TOKENS,
    ...RATE_LIMIT_DETAILS_A,
  });
  assert.notEqual(events[0].limitTokens, events[0].rateLimitTokenLimit);
  assert.deepEqual(events[1], {
    event: "application_brief_semantic_matcher_retry",
    nextAttempt: MAXIMUM_CROSS_CLASS_ATTEMPTS,
    retryReason: "JSON_VALIDATE_FAILED_AFTER_TOKEN_BUDGET_413",
    status: HTTP_BAD_REQUEST,
    providerType: "invalid_request_error",
    providerCode: "json_validate_failed",
    nextMaxTokens: EXPECTED_RETRY_MAX_TOKENS,
    ...RATE_LIMIT_DETAILS_B,
  });
  const serialized = JSON.stringify(events);
  for (const forbidden of [
    "unknown", "private", "message", "headers", "authorization", "failed_generation",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("cross-class diagnostics never inherit prior attempt rate-limit metadata", async () => {
  const logs = [];
  let calls = 0;
  const matcher = createMatcher(async () => {
    calls += 1;
    if (calls === 1) {
      throw new GroqJsonClientError(GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED, {
        limitTokens: 10000,
        requestedTokens: 11000,
        ...RATE_LIMIT_DETAILS_A,
      });
    }
    if (calls === MAXIMUM_TECHNICAL_ATTEMPTS) {
      throw createJsonValidationError();
    }
    return createOutput();
  }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL), {
    warn(value) {
      logs.push(value);
    },
  });

  await matcher.match({ offer: {}, candidate: {} });
  assert.equal(calls, MAXIMUM_CROSS_CLASS_ATTEMPTS);
  assert.deepEqual(logs.map(JSON.parse)[1], {
    event: "application_brief_semantic_matcher_retry",
    nextAttempt: MAXIMUM_CROSS_CLASS_ATTEMPTS,
    retryReason: "JSON_VALIDATE_FAILED_AFTER_TOKEN_BUDGET_413",
    status: HTTP_BAD_REQUEST,
    providerType: "invalid_request_error",
    providerCode: "json_validate_failed",
    nextMaxTokens: EXPECTED_RETRY_MAX_TOKENS,
    ...NULL_RATE_LIMIT_DETAILS,
  });
});

test("initial JSON retry exposes only its own typed rate-limit metadata", async () => {
  const logs = [];
  let calls = 0;
  const matcher = createMatcher(async () => {
    calls += 1;
    if (calls === 1) {
      throw createJsonValidationError(RATE_LIMIT_DETAILS_A);
    }
    return createOutput();
  }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL), {
    warn(value) {
      logs.push(value);
    },
  });

  await matcher.match({ offer: {}, candidate: {} });
  assert.equal(calls, MAXIMUM_TECHNICAL_ATTEMPTS);
  assert.deepEqual(logs.map(JSON.parse), [{
    event: "application_brief_semantic_matcher_retry",
    attempt: MAXIMUM_TECHNICAL_ATTEMPTS,
    status: HTTP_BAD_REQUEST,
    providerType: "invalid_request_error",
    providerCode: "json_validate_failed",
    ...RATE_LIMIT_DETAILS_A,
  }, createProviderSuccessEvent(
    MAXIMUM_TECHNICAL_ATTEMPTS,
    ApplicationBriefMatcherConstants.MAX_OUTPUT_TOKENS,
  )]);
});

test("cross-class final errors win without a fourth call", async () => {
  for (const [finalError, expectedCode] of [
    [createJsonValidationError(), ApplicationBriefMatcherError.CODE.PROVIDER_ERROR],
    [new GroqJsonClientError(GroqJsonClientError.CODE.RATE_LIMITED),
      ApplicationBriefMatcherError.CODE.RATE_LIMITED],
    [new GroqJsonClientError(GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED),
      ApplicationBriefMatcherError.CODE.PROVIDER_TOKEN_BUDGET],
  ]) {
    let calls = 0;
    const matcher = createMatcher(async () => {
      calls += 1;
      if (calls === 1) {
        throw new GroqJsonClientError(GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED, {
          limitTokens: 10000,
          requestedTokens: 11000,
        });
      }
      if (calls === MAXIMUM_TECHNICAL_ATTEMPTS) {
        throw createJsonValidationError();
      }
      throw finalError;
    }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL));

    await assert.rejects(matcher.match({ offer: {}, candidate: {} }), (error) => {
      assert.equal(error.code, expectedCode);
      return true;
    });
    assert.equal(calls, MAXIMUM_CROSS_CLASS_ATTEMPTS);
  }
});

test("non-120B models never receive cross-class recovery", async () => {
  for (const model of [GPT_OSS_20B_MODEL, HISTORICAL_MODEL]) {
    let calls = 0;
    const matcher = createMatcher(async () => {
      calls += 1;
      if (calls === 1) {
        throw new GroqJsonClientError(GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED, {
          limitTokens: 10000,
          requestedTokens: 11000,
        });
      }
      throw createJsonValidationError();
    }, ApplicationBriefSemanticMatcher.buildConfig(model));
    await assert.rejects(matcher.match({ offer: {}, candidate: {} }), (error) => {
      assert.equal(error.code, ApplicationBriefMatcherError.CODE.PROVIDER_ERROR);
      return true;
    });
    assert.equal(calls, MAXIMUM_TECHNICAL_ATTEMPTS);
  }
});

test("semantic validation after cross-class success never performs another provider call", async () => {
  let calls = 0;
  const matcher = createMatcher(async () => {
    calls += 1;
    if (calls === 1) {
      throw new GroqJsonClientError(GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED, {
        limitTokens: 10000,
        requestedTokens: 11000,
      });
    }
    if (calls === MAXIMUM_TECHNICAL_ATTEMPTS) {
      throw createJsonValidationError();
    }
    return { requirementMatches: [] };
  }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL));
  await assert.rejects(matcher.match({ offer: {}, candidate: {} }), (error) => {
    assert.equal(error.code, ApplicationBriefMatcherError.CODE.INVALID_OUTPUT);
    return true;
  });
  assert.equal(calls, MAXIMUM_CROSS_CLASS_ATTEMPTS);
});

test("unsafe or unrecognized token budgets never emit a retry event", async () => {
  for (const error of [
    new GroqJsonClientError(GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED, {
      limitTokens: 10000,
      requestedTokens: 13000,
    }),
    new GroqJsonClientError(GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED, {}),
    new GroqJsonClientError(GroqJsonClientError.CODE.HTTP_ERROR, {
      status: HTTP_CONTENT_TOO_LARGE,
      providerType: "tokens",
      providerCode: "rate_limit_exceeded",
    }),
  ]) {
    const logs = [];
    let calls = 0;
    const matcher = createMatcher(async () => {
      calls += 1;
      throw error;
    }, ApplicationBriefSemanticMatcher.buildConfig(GPT_OSS_120B_MODEL), {
      warn(value) {
        logs.push(value);
      },
    });
    await assert.rejects(matcher.match({ offer: {}, candidate: {} }));
    assert.equal(calls, 1);
    assert.deepEqual(logs, []);
  }
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

test("repeated token failure stops after two calls and unsafe budgets stop immediately", async () => {
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
