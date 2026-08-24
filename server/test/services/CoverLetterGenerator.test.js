import test from "node:test";
import assert from "node:assert/strict";
import { CoverLetterConstants } from "../../src/constants/CoverLetterConstants.js";
import { CoverLetterGeneratorConstants } from "../../src/constants/CoverLetterGeneratorConstants.js";
import { CoverLetterLimits } from "../../src/constants/CoverLetterLimits.js";
import { CoverLetter } from "../../src/models/CoverLetter.js";
import { CoverLetterGenerator } from "../../src/services/CoverLetterGenerator.js";
import { CoverLetterGeneratorError } from "../../src/services/CoverLetterGeneratorError.js";
import { CoverLetterOutputValidator } from "../../src/services/CoverLetterOutputValidator.js";
import { CoverLetterPrompt } from "../../src/services/CoverLetterPrompt.js";
import { GroqJsonClientError } from "../../src/services/GroqJsonClientError.js";

const MODEL = "cover-letter-model";
const SECOND_INDEX = 2;
const THIRD_INDEX = 5;
const NON_CONTIGUOUS_INDEX = 7;
const MAXIMUM_TECHNICAL_ATTEMPTS = 2;
const LETTER = "L".repeat(CoverLetterLimits.MINIMUM_LETTER_LENGTH);

/**
 * Build one valid minimal CoverLetter generation projection.
 * @param {number[]} [indexes] - Exact non-contiguous claim indexes.
 * @returns {object} Generation input fixture.
 */
function createInput(indexes = [0, SECOND_INDEX, THIRD_INDEX]) {
  return {
    offer: { title: "Engineer", company: "Example" },
    claims: indexes.map((index) => {
      return {
        index, type: "skill",
        candidateEvidence: [{
          source: "skill", facts: [{ attribute: "skill", value: `Skill ${index}` }],
        }],
        relatedOfferElements: [{ type: "requirement", value: "Build products" }],
        priority: null, strategyReason: null,
      };
    }),
    boundaries: {
      partialRequirements: [], notEvidencedFacets: [], cautions: [],
    },
  };
}

/**
 * Build a generator with an injectable fake completion.
 * @param {Function} completeJson - Fake Groq completion.
 * @param {object} [config] - Optional execution configuration.
 * @returns {CoverLetterGenerator} Generator fixture.
 */
function createGenerator(
  completeJson,
  config = CoverLetterGenerator.buildConfig(MODEL),
  logger = { warn() {} },
) {
  return new CoverLetterGenerator({
    promptBuilder: new CoverLetterPrompt(),
    groqClient: { completeJson },
    outputValidator: new CoverLetterOutputValidator(),
    config,
    logger,
  });
}

/**
 * Require one generator failure code.
 * @param {Promise<unknown>} promise - Rejected generation promise.
 * @param {string} code - Expected safe code.
 * @returns {Promise<void>}
 */
async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error instanceof CoverLetterGeneratorError, true);
    assert.equal(error.code, code);
    return true;
  });
}

test("happy path sends only the projection and returns exact immutable CoverLetter", async () => {
  const requests = [];
  const input = createInput();
  const snapshot = structuredClone(input);
  const generator = createGenerator(async (request) => {
    requests.push(structuredClone(request));
    return { letter: LETTER, usedClaimIndexes: [0, THIRD_INDEX] };
  });
  const result = await generator.generate(input);

  assert.equal(result instanceof CoverLetter, true);
  assert.deepEqual(result.toJson(), {
    schemaVersion: CoverLetterConstants.SCHEMA_VERSION,
    letter: LETTER,
    usedClaimIndexes: [0, THIRD_INDEX],
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, MODEL);
  assert.equal(requests[0].timeout, CoverLetterGeneratorConstants.TIMEOUT_MS);
  assert.equal(requests[0].maxTokens, CoverLetterGeneratorConstants.MAX_OUTPUT_TOKENS);
  assert.equal(Object.hasOwn(requests[0], "responseFormat"), false);
  assert.equal(Object.hasOwn(requests[0], "reasoningEffort"), false);
  assert.equal(requests[0].userPrompt.endsWith(JSON.stringify(input)), true);
  assert.deepEqual(input, snapshot);
});

test("zero claims fail before Groq without a generic letter", async () => {
  let calls = 0;
  const generator = createGenerator(async () => {
    calls += 1;
    return { letter: LETTER, usedClaimIndexes: [0] };
  });
  await expectCode(
    generator.generate(createInput([])),
    CoverLetterGeneratorError.CODE.INSUFFICIENT_SUPPORTED_CLAIMS,
  );
  assert.equal(calls, 0);
});

test("serialized input exact limit passes and excess fails without truncation or Groq", async () => {
  let calls = 0;
  const generator = createGenerator(async () => {
    calls += 1;
    return { letter: LETTER, usedClaimIndexes: [0] };
  });
  const exact = createInput([0]);
  const emptyCompanyLength = JSON.stringify(exact).length;
  exact.offer.company = "x".repeat(
    CoverLetterGeneratorConstants.MAX_INPUT_CHARACTERS
      - emptyCompanyLength
      + exact.offer.company.length,
  );
  assert.equal(JSON.stringify(exact).length, CoverLetterGeneratorConstants.MAX_INPUT_CHARACTERS);
  await generator.generate(exact);
  assert.equal(calls, 1);

  const excessive = structuredClone(exact);
  excessive.offer.company += "x";
  await expectCode(
    generator.generate(excessive),
    CoverLetterGeneratorError.CODE.INPUT_TOO_LARGE,
  );
  assert.equal(calls, 1);
  assert.equal(excessive.offer.company.endsWith("x"), true);
});

test("input preconditions reject non-JSON roots cycles and duplicate claim indexes", async () => {
  const generator = createGenerator(async () => {
    return { letter: LETTER, usedClaimIndexes: [0] };
  });
  const cyclic = createInput([0]);
  cyclic.offer.self = cyclic;
  const duplicate = createInput([0, 0]);
  for (const invalid of [null, [], { offer: {}, claims: [], boundaries: {}, extra: true },
    cyclic, duplicate]) {
    await assert.rejects(generator.generate(invalid), TypeError);
  }
});

test("non-contiguous used claim indexes validate against values not array positions", async () => {
  const validGenerator = createGenerator(async () => {
    return { letter: LETTER, usedClaimIndexes: [NON_CONTIGUOUS_INDEX] };
  });
  const valid = await validGenerator.generate(createInput([SECOND_INDEX, NON_CONTIGUOUS_INDEX]));
  assert.deepEqual(valid.usedClaimIndexes, [NON_CONTIGUOUS_INDEX]);

  const invalidGenerator = createGenerator(async () => {
    return { letter: LETTER, usedClaimIndexes: [1] };
  });
  await expectCode(
    invalidGenerator.generate(createInput([SECOND_INDEX, NON_CONTIGUOUS_INDEX])),
    CoverLetterGeneratorError.CODE.INVALID_OUTPUT,
  );
});

test("output validator rejects empty duplicate and malformed generated indexes once", async () => {
  for (const usedClaimIndexes of [[], [0, 0], ["0"]]) {
    let calls = 0;
    const generator = createGenerator(async () => {
      calls += 1;
      return { letter: LETTER, usedClaimIndexes };
    });
    await expectCode(
      generator.generate(createInput([0])),
      CoverLetterGeneratorError.CODE.INVALID_OUTPUT,
    );
    assert.equal(calls, 1);
  }
});

test("invalid output root and letter fail without semantic retry", async () => {
  for (const output of [
    { letter: LETTER },
    { letter: "short", usedClaimIndexes: [0] },
  ]) {
    let calls = 0;
    const generator = createGenerator(async () => {
      calls += 1;
      return output;
    });
    await expectCode(
      generator.generate(createInput([0])),
      CoverLetterGeneratorError.CODE.INVALID_OUTPUT,
    );
    assert.equal(calls, 1);
  }
});

test("recognized provider errors map to the closed generator taxonomy with one call", async () => {
  const mappings = [
    [GroqJsonClientError.CODE.UNAVAILABLE, CoverLetterGeneratorError.CODE.UNAVAILABLE],
    [GroqJsonClientError.CODE.AUTHENTICATION_ERROR, CoverLetterGeneratorError.CODE.UNAVAILABLE],
    [GroqJsonClientError.CODE.TIMEOUT, CoverLetterGeneratorError.CODE.TIMEOUT],
    [GroqJsonClientError.CODE.RATE_LIMITED, CoverLetterGeneratorError.CODE.RATE_LIMITED],
    [GroqJsonClientError.CODE.HTTP_ERROR, CoverLetterGeneratorError.CODE.PROVIDER_ERROR],
    [GroqJsonClientError.CODE.INVALID_RESPONSE, CoverLetterGeneratorError.CODE.INVALID_OUTPUT],
  ];
  for (const [transportCode, generatorCode] of mappings) {
    let calls = 0;
    const cause = new GroqJsonClientError(transportCode);
    const generator = createGenerator(async () => {
      calls += 1;
      throw cause;
    });
    await assert.rejects(generator.generate(createInput([0])), (error) => {
      assert.equal(error.code, generatorCode);
      assert.equal(error.cause, cause);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("one technical token-budget retry reuses prompts with a lower ceiling", async () => {
  const requests = [];
  const generator = createGenerator(async (request) => {
    requests.push(structuredClone(request));
    if (requests.length === 1) {
      throw new GroqJsonClientError(GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED, {
        limitTokens: 10000,
        requestedTokens: 10200,
      });
    }
    return { letter: LETTER, usedClaimIndexes: [0] };
  });
  const result = await generator.generate(createInput([0]));

  assert.equal(result instanceof CoverLetter, true);
  assert.equal(requests.length, MAXIMUM_TECHNICAL_ATTEMPTS);
  assert.equal(requests[1].systemPrompt, requests[0].systemPrompt);
  assert.equal(requests[1].userPrompt, requests[0].userPrompt);
  assert.equal(requests[1].maxTokens < requests[0].maxTokens, true);
});

test("token-budget retry stops after two calls and unsafe diagnostics stop immediately", async () => {
  let calls = 0;
  const retrying = createGenerator(async () => {
    calls += 1;
    throw new GroqJsonClientError(GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED, {
      limitTokens: 10000, requestedTokens: 10200,
    });
  });
  await expectCode(
    retrying.generate(createInput([0])),
    CoverLetterGeneratorError.CODE.PROVIDER_TOKEN_BUDGET,
  );
  assert.equal(calls, MAXIMUM_TECHNICAL_ATTEMPTS);

  calls = 0;
  const unsafe = createGenerator(async () => {
    calls += 1;
    throw new GroqJsonClientError(GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED, {});
  });
  await expectCode(
    unsafe.generate(createInput([0])),
    CoverLetterGeneratorError.CODE.PROVIDER_TOKEN_BUDGET,
  );
  assert.equal(calls, 1);
});

test("timeout rate limit and invalid output never receive a technical retry", async () => {
  for (const [failure, expectedCode] of [
    [new GroqJsonClientError(GroqJsonClientError.CODE.TIMEOUT),
      CoverLetterGeneratorError.CODE.TIMEOUT],
    [new GroqJsonClientError(GroqJsonClientError.CODE.RATE_LIMITED),
      CoverLetterGeneratorError.CODE.RATE_LIMITED],
  ]) {
    let calls = 0;
    const generator = createGenerator(async () => {
      calls += 1;
      throw failure;
    });
    await expectCode(generator.generate(createInput([0])), expectedCode);
    assert.equal(calls, 1);
  }
});

test("terminal rate limit emits one event with all safe typed metadata", async () => {
  let calls = 0;
  const logs = [];
  const rateLimitDetails = {
    status: 429,
    rateLimitTokenLimit: 12000,
    rateLimitTokenRemaining: 8000,
    rateLimitTokenResetMs: 1500,
    rateLimitRequestLimit: 100,
    rateLimitRequestRemaining: 80,
    rateLimitRequestResetMs: 2500,
    retryAfterMs: 3000,
  };
  const cause = new GroqJsonClientError(
    GroqJsonClientError.CODE.RATE_LIMITED,
    rateLimitDetails,
  );
  const generator = createGenerator(async () => {
    calls += 1;
    throw cause;
  }, CoverLetterGenerator.buildConfig(MODEL), {
    warn(value) {
      logs.push(value);
    },
  });

  await assert.rejects(generator.generate(createInput([0])), (error) => {
    assert.equal(error.code, CoverLetterGeneratorError.CODE.RATE_LIMITED);
    assert.equal(error.cause, cause);
    return true;
  });
  assert.equal(calls, 1);
  assert.deepEqual(logs.map(JSON.parse), [{
    event: "cover_letter_provider_rate_limited",
    rateLimitTokenLimit: 12000,
    rateLimitTokenRemaining: 8000,
    rateLimitTokenResetMs: 1500,
    rateLimitRequestLimit: 100,
    rateLimitRequestRemaining: 80,
    rateLimitRequestResetMs: 2500,
    retryAfterMs: 3000,
  }]);
});

test("rate-limit event preserves only available typed metadata without defaults", async () => {
  const logs = [];
  const generator = createGenerator(async () => {
    throw new GroqJsonClientError(GroqJsonClientError.CODE.RATE_LIMITED, {
      status: 429,
      rateLimitTokenRemaining: 8000,
      retryAfterMs: 3000,
    });
  }, CoverLetterGenerator.buildConfig(MODEL), {
    warn(value) {
      logs.push(value);
    },
  });

  await expectCode(
    generator.generate(createInput([0])),
    CoverLetterGeneratorError.CODE.RATE_LIMITED,
  );
  assert.deepEqual(logs.map(JSON.parse), [{
    event: "cover_letter_provider_rate_limited",
    rateLimitTokenRemaining: 8000,
    retryAfterMs: 3000,
  }]);
});

test("rate-limit event discards invalid typed metadata", async () => {
  const logs = [];
  const generator = createGenerator(async () => {
    throw new GroqJsonClientError(GroqJsonClientError.CODE.RATE_LIMITED, {
      status: 429,
      rateLimitTokenLimit: "private",
      rateLimitTokenRemaining: -1,
      retryAfterMs: { private: true },
      arbitrary: "private",
    });
  }, CoverLetterGenerator.buildConfig(MODEL), {
    warn(value) {
      logs.push(value);
    },
  });

  await expectCode(
    generator.generate(createInput([0])),
    CoverLetterGeneratorError.CODE.RATE_LIMITED,
  );
  assert.deepEqual(logs.map(JSON.parse), [{
    event: "cover_letter_provider_rate_limited",
  }]);
});

test("rate-limit event remains closed when no metadata is available", async () => {
  const logs = [];
  const generator = createGenerator(async () => {
    throw new GroqJsonClientError(GroqJsonClientError.CODE.RATE_LIMITED);
  }, CoverLetterGenerator.buildConfig(MODEL), {
    warn(value) {
      logs.push(value);
    },
  });

  await expectCode(
    generator.generate(createInput([0])),
    CoverLetterGeneratorError.CODE.RATE_LIMITED,
  );
  assert.deepEqual(logs.map(JSON.parse), [{
    event: "cover_letter_provider_rate_limited",
  }]);
});

test("non-rate-limit failures never emit the rate-limit event", async () => {
  for (const failure of [
    new GroqJsonClientError(GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED),
    new GroqJsonClientError(GroqJsonClientError.CODE.TIMEOUT),
    new GroqJsonClientError(GroqJsonClientError.CODE.HTTP_ERROR),
    new GroqJsonClientError(GroqJsonClientError.CODE.INVALID_RESPONSE),
  ]) {
    const logs = [];
    const generator = createGenerator(async () => {
      throw failure;
    }, CoverLetterGenerator.buildConfig(MODEL), {
      warn(value) {
        logs.push(value);
      },
    });
    await assert.rejects(generator.generate(createInput([0])));
    assert.deepEqual(logs, []);
  }
});

test("rate-limit logger failure never changes the terminal error", async () => {
  let calls = 0;
  const cause = new GroqJsonClientError(GroqJsonClientError.CODE.RATE_LIMITED, {
    status: 429,
    retryAfterMs: 3000,
  });
  const generator = createGenerator(async () => {
    calls += 1;
    throw cause;
  }, CoverLetterGenerator.buildConfig(MODEL), {
    warn() {
      throw new Error("logger unavailable");
    },
  });

  await assert.rejects(generator.generate(createInput([0])), (error) => {
    assert.equal(error.code, CoverLetterGeneratorError.CODE.RATE_LIMITED);
    assert.equal(error.cause, cause);
    return true;
  });
  assert.equal(calls, 1);
});

test("generator preserves input and output exactly without claim pre-filtering", async () => {
  const input = createInput([SECOND_INDEX, NON_CONTIGUOUS_INDEX]);
  const snapshot = structuredClone(input);
  let transmitted;
  const generator = createGenerator(async (request) => {
    transmitted = request.userPrompt;
    return { letter: ` ${LETTER.slice(1)}`, usedClaimIndexes: [NON_CONTIGUOUS_INDEX] };
  });
  const result = await generator.generate(input);

  assert.equal(result.letter, ` ${LETTER.slice(1)}`);
  assert.equal(transmitted.endsWith(JSON.stringify(input)), true);
  assert.equal(transmitted.includes(`Skill ${SECOND_INDEX}`), true);
  assert.equal(transmitted.includes(`Skill ${NON_CONTIGUOUS_INDEX}`), true);
  assert.deepEqual(input, snapshot);
});

test("error taxonomy and execution configuration are closed and deterministic", () => {
  assert.deepEqual(Object.values(CoverLetterGeneratorError.CODE), [
    "COVER_LETTER_INPUT_TOO_LARGE", "INSUFFICIENT_SUPPORTED_CLAIMS",
    "COVER_LETTER_UNAVAILABLE", "COVER_LETTER_TIMEOUT", "COVER_LETTER_RATE_LIMITED",
    "COVER_LETTER_PROVIDER_TOKEN_BUDGET", "COVER_LETTER_PROVIDER_ERROR",
    "INVALID_COVER_LETTER_OUTPUT",
  ]);
  assert.deepEqual(CoverLetterGenerator.buildConfig(MODEL), {
    model: MODEL,
    timeout: CoverLetterGeneratorConstants.TIMEOUT_MS,
    maxTokens: CoverLetterGeneratorConstants.MAX_OUTPUT_TOKENS,
    maxInputCharacters: CoverLetterGeneratorConstants.MAX_INPUT_CHARACTERS,
  });
});
