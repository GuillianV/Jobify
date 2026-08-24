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
const MAXIMUM_CROSS_CLASS_ATTEMPTS = 3;
const EXPECTED_RETRY_MAX_TOKENS = 3095;
const HTTP_BAD_REQUEST = 400;
const HTTP_CONTENT_TOO_LARGE = 413;

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
function createMatcher(
  completeJson,
  config = ApplicationBriefSemanticMatcher.buildConfig(MODEL),
  logger = { warn() {} },
) {
  return new ApplicationBriefSemanticMatcher({
    promptBuilder: new ApplicationBriefPrompt(),
    groqClient: { completeJson },
    semanticValidator: new ApplicationBriefSemanticOutputValidator(),
    config,
    logger,
  });
}

/**
 * Build the exact transient structured-output provider failure.
 * @returns {GroqJsonClientError} Targeted safe provider error.
 */
function createJsonValidationError() {
  return new GroqJsonClientError(GroqJsonClientError.CODE.HTTP_ERROR, {
    status: HTTP_BAD_REQUEST,
    providerType: "invalid_request_error",
    providerCode: "json_validate_failed",
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

test("known GPT-OSS models compose strict semantic schema with low reasoning", async () => {
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

test("success and initial rate limit never emit retry observability", async () => {
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
    assert.deepEqual(logs, []);
  }
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
  }]);
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

test("one technical token retry preserves strict schema and low reasoning", async () => {
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
    assert.deepEqual(
      requests[0].responseFormat,
      ApplicationBriefSemanticJsonSchema.createResponseFormat(),
    );
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
    }]);
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
  }, {
    event: "application_brief_semantic_matcher_retry",
    nextAttempt: MAXIMUM_CROSS_CLASS_ATTEMPTS,
    retryReason: "JSON_VALIDATE_FAILED_AFTER_TOKEN_BUDGET_413",
    status: HTTP_BAD_REQUEST,
    providerType: "invalid_request_error",
    providerCode: "json_validate_failed",
    nextMaxTokens: EXPECTED_RETRY_MAX_TOKENS,
  }]);
  for (const log of logs) {
    for (const forbidden of [
      "systemPrompt", "userPrompt", "candidate", "offer", "failed_generation",
    ]) {
      assert.equal(log.includes(forbidden), false);
    }
  }
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
