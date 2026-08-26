import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationBriefIntegritySigner } from "../../src/services/ApplicationBriefIntegritySigner.js";
import { ApplicationBriefContextValidationError } from "../../src/services/ApplicationBriefContextValidationError.js";
import { ApplicationBriefMatcherError } from "../../src/services/ApplicationBriefMatcherError.js";
import { ApplicationBriefService } from "../../src/services/ApplicationBriefService.js";
import { GroqJsonClientError } from "../../src/services/GroqJsonClientError.js";

const REQUESTED_OFFER_ID = 42;
const AUTHORITATIVE_OFFER_ID = 84;
const SHA_256_HEX_LENGTH = 64;
const SIGNING_SECRET_BYTES = 32;
const HTTP_BAD_REQUEST = 400;
const HTTP_SERVER_ERROR = 500;
const NULL_RATE_LIMIT_DETAILS = Object.freeze({
  rateLimitTokenLimit: null,
  rateLimitTokenRemaining: null,
  rateLimitTokenResetMs: null,
  rateLimitRequestLimit: null,
  rateLimitRequestRemaining: null,
  rateLimitRequestResetMs: null,
  retryAfterMs: null,
});
const RATE_LIMIT_DETAILS = Object.freeze({
  rateLimitTokenLimit: 12000,
  rateLimitTokenRemaining: 8000,
  rateLimitTokenResetMs: 1500,
  rateLimitRequestLimit: 100,
  rateLimitRequestRemaining: 80,
  rateLimitRequestResetMs: 2500,
  retryAfterMs: 3000,
});

/**
 * Build one service harness with observable injected collaborators.
 * @param {object} [behavior] - Optional collaborator behavior.
 * @returns {object} Service, inputs, result, and captured calls.
 */
function createHarness(behavior = {}) {
  const calls = { analysis: [], candidate: 0, builder: [], sign: [], logs: [] };
  const analysis = { requirements: [] };
  const offerSnapshot = { offerId: AUTHORITATIVE_OFFER_ID, title: "Backend Engineer" };
  const identity = {
    offerId: AUTHORITATIVE_OFFER_ID,
    cacheKey: "a".repeat(SHA_256_HEX_LENGTH),
    schemaVersion: "offer-analysis-schema-v1",
    policyVersion: "offer-analyzer-policy-v1",
    provider: "private-provider",
  };
  const analysisResult = {
    analysis,
    identity,
    offerSnapshot,
    cacheHit: behavior.cacheHit ?? true,
    analyzer: { policyVersion: "wrong-policy", schemaVersion: "wrong-schema" },
  };
  const dossier = { schemaVersion: "candidate-dossier-schema-v1" };
  const candidateResult = { dossier, updatedAt: "private-timestamp" };
  const briefJson = { kind: "application-brief" };
  const brief = {
    toJson() {
      return structuredClone(briefJson);
    },
  };
  const signer = new ApplicationBriefIntegritySigner(
    Buffer.alloc(SIGNING_SECRET_BYTES, 1),
  );
  const originalSign = signer.sign.bind(signer);
  signer.sign = (value) => {
    calls.sign.push(value);
    return originalSign(value);
  };
  const offerAnalysisService = {
    async analyze(offerId) {
      calls.analysis.push(offerId);
      if (behavior.analysisError) {
        throw behavior.analysisError;
      }
      return analysisResult;
    },
  };
  const candidateDossierService = {
    get() {
      calls.candidate += 1;
      if (behavior.candidateError) {
        throw behavior.candidateError;
      }
      return candidateResult;
    },
  };
  const applicationBriefBuilder = {
    async build(inputs) {
      calls.builder.push(inputs);
      if (behavior.builderError) {
        throw behavior.builderError;
      }
      return brief;
    },
  };
  const service = new ApplicationBriefService({
    offerAnalysisService,
    candidateDossierService,
    applicationBriefBuilder,
    applicationBriefIntegritySigner: signer,
    logger: {
      warn(value) {
        calls.logs.push(value);
        if (behavior.loggerError) {
          throw behavior.loggerError;
        }
      },
    },
  });
  return { service, calls, analysisResult, candidateResult, brief, briefJson, signer };
}

for (const cacheHit of [true, false]) {
  test(`service forwards authoritative inputs on cacheHit ${cacheHit}`, async () => {
    const harness = createHarness({ cacheHit });
    const analysisSnapshot = structuredClone(harness.analysisResult);
    const candidateSnapshot = structuredClone(harness.candidateResult);
    const result = await harness.service.generateForOffer(REQUESTED_OFFER_ID);

    assert.deepEqual(Object.keys(result), ["brief", "generationToken"]);
    assert.deepEqual(result.brief, harness.briefJson);
    assert.equal(typeof result.generationToken, "string");
    assert.equal(harness.signer.verify(result.brief, result.generationToken), true);
    assert.equal(harness.calls.sign[0], result.brief);
    assert.deepEqual(harness.calls.analysis, [REQUESTED_OFFER_ID]);
    assert.equal(harness.calls.candidate, 1);
    assert.equal(harness.calls.builder.length, 1);
    assert.deepEqual(harness.calls.builder[0], {
      offerAnalysis: harness.analysisResult.analysis,
      offerSnapshot: harness.analysisResult.offerSnapshot,
      offerIdentity: {
        offerId: AUTHORITATIVE_OFFER_ID,
        analysisFingerprint: harness.analysisResult.identity.cacheKey,
        analysisSchemaVersion: harness.analysisResult.identity.schemaVersion,
        analyzerPolicyVersion: harness.analysisResult.identity.policyVersion,
      },
      candidateDossier: harness.candidateResult.dossier,
    });
    assert.equal(harness.calls.builder[0].offerSnapshot, harness.analysisResult.offerSnapshot);
    assert.equal("updatedAt" in harness.calls.builder[0], false);
    assert.deepEqual(harness.analysisResult, analysisSnapshot);
    assert.deepEqual(harness.candidateResult, candidateSnapshot);
    assert.deepEqual(harness.calls.logs, []);
  });
}

test("service propagates collaborator failures without wrapping", async () => {
  for (const source of ["analysisError", "candidateError", "builderError"]) {
    const expected = new Error(source);
    const harness = createHarness({ [source]: expected });
    await assert.rejects(harness.service.generateForOffer(REQUESTED_OFFER_ID), (error) => {
      return error === expected;
    });
    assert.deepEqual(harness.calls.sign, []);
  }
});

test("service logs provider invalid response once with closed details", async () => {
  const cause = new GroqJsonClientError(GroqJsonClientError.CODE.INVALID_RESPONSE);
  const expected = new ApplicationBriefMatcherError(
    ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
    ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT,
    cause,
  );
  const harness = createHarness({ builderError: expected });

  await assert.rejects(harness.service.generateForOffer(REQUESTED_OFFER_ID), (error) => {
    return error === expected;
  });
  assert.deepEqual(harness.calls.logs.map(JSON.parse), [{
    event: "application_brief_semantic_matcher_invalid_output",
    validationCode: "PROVIDER_INVALID_RESPONSE",
    validationSubcode: null,
  }]);
});

test("service logs semantic validation once and neutralizes unsafe details", async () => {
  const cases = [
    [
      new ApplicationBriefMatcherError(
        ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
        ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT,
        null,
        { validationCode: "SEMANTIC_VALIDATION", validationSubcode: "ENUM" },
      ),
      { validationCode: "SEMANTIC_VALIDATION", validationSubcode: "ENUM" },
    ],
    [
      new ApplicationBriefMatcherError(
        ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
        ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT,
        null,
        { validationCode: "private code", validationSubcode: "private detail" },
      ),
      { validationCode: null, validationSubcode: null },
    ],
    [
      new ApplicationBriefMatcherError(
        ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
        ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT,
        null,
        { validationCode: "PROVIDER_INVALID_RESPONSE", validationSubcode: "ENUM" },
      ),
      { validationCode: null, validationSubcode: null },
    ],
  ];
  for (const [expected, details] of cases) {
    const harness = createHarness({ builderError: expected });
    await assert.rejects(harness.service.generateForOffer(REQUESTED_OFFER_ID), (error) => {
      return error === expected;
    });
    assert.deepEqual(harness.calls.logs.map(JSON.parse), [{
      event: "application_brief_semantic_matcher_invalid_output",
      ...details,
    }]);
  }
});

test("service logs only one recognized cardinality rule", async () => {
  const cases = [
    ["ROOT_EMPHASIS_MAX", "ROOT_EMPHASIS_MAX"],
    ["private cardinality", undefined],
  ];
  for (const [cardinalityRule, expectedRule] of cases) {
    const error = new ApplicationBriefMatcherError(
      ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
      ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT,
      null,
      {
        validationCode: "SEMANTIC_VALIDATION",
        validationSubcode: "CARDINALITY",
        cardinalityRule,
        actualCount: "private count",
      },
    );
    const harness = createHarness({ builderError: error });
    await assert.rejects(harness.service.generateForOffer(REQUESTED_OFFER_ID), (caught) => {
      return caught === error;
    });
    const expected = {
      event: "application_brief_semantic_matcher_invalid_output",
      validationCode: "SEMANTIC_VALIDATION",
      validationSubcode: "CARDINALITY",
    };
    if (expectedRule !== undefined) {
      expected.cardinalityRule = expectedRule;
    }
    assert.deepEqual(harness.calls.logs.map(JSON.parse), [expected]);
    assert.deepEqual(harness.calls.sign, []);
    assert.equal(harness.calls.logs[0].includes("actualCount"), false);
  }
});

test("service logs only one recognized nested-shape rule", async () => {
  const cases = [
    ["REQUIREMENT_MATCH_OBJECT_SHAPE", "REQUIREMENT_MATCH_OBJECT_SHAPE"],
    ["REQUIREMENT_MATCH_EXACT_KEYS", "REQUIREMENT_MATCH_EXACT_KEYS"],
    ["SUPPORTED_CLAIM_SHAPE", "SUPPORTED_CLAIM_SHAPE"],
    ["private nested shape", undefined],
  ];
  for (const [nestedShapeRule, expectedRule] of cases) {
    const error = new ApplicationBriefMatcherError(
      ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
      ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT,
      null,
      {
        validationCode: "SEMANTIC_VALIDATION",
        validationSubcode: "NESTED_SHAPE_OR_KEYS",
        nestedShapeRule,
        missingKey: "private key",
      },
    );
    const harness = createHarness({ builderError: error });
    await assert.rejects(harness.service.generateForOffer(REQUESTED_OFFER_ID), (caught) => {
      return caught === error;
    });
    const expected = {
      event: "application_brief_semantic_matcher_invalid_output",
      validationCode: "SEMANTIC_VALIDATION",
      validationSubcode: "NESTED_SHAPE_OR_KEYS",
    };
    if (expectedRule !== undefined) {
      expected.nestedShapeRule = expectedRule;
    }
    assert.deepEqual(harness.calls.logs.map(JSON.parse), [expected]);
    assert.deepEqual(harness.calls.sign, []);
    assert.equal(harness.calls.logs[0].includes("missingKey"), false);
  }
});

test("service logs only closed semantic structural localization", async () => {
  const rejectedValue = "private rejected value";
  const expected = new ApplicationBriefMatcherError(
    ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
    ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT,
    null,
    {
      validationCode: "SEMANTIC_VALIDATION",
      validationSubcode: "TEXT_OR_IDENTIFIER_FORMAT",
      validationPath: "emphasis[0].relevanceReason",
      validationCategory: "TEXT",
      validationRule: "TEXT_BLANK",
      value: rejectedValue,
    },
  );
  const harness = createHarness({ builderError: expected });

  await assert.rejects(harness.service.generateForOffer(REQUESTED_OFFER_ID), (error) => {
    return error === expected;
  });
  assert.deepEqual(harness.calls.logs.map(JSON.parse), [{
    event: "application_brief_semantic_matcher_invalid_output",
    validationCode: "SEMANTIC_VALIDATION",
    validationSubcode: "TEXT_OR_IDENTIFIER_FORMAT",
    validationPath: "emphasis[0].relevanceReason",
    validationCategory: "TEXT",
    validationRule: "TEXT_BLANK",
  }]);
  assert.equal(harness.calls.logs[0].includes(rejectedValue), false);
  assert.deepEqual(harness.calls.sign, []);
});

test("service logs only mapped contextual invalid-output reasons", async () => {
  const reasons = [
    ApplicationBriefContextValidationError.REASON.INVALID_EVIDENCE_REFERENCE,
    ApplicationBriefContextValidationError.REASON.INVALID_OFFER_REFERENCE,
    ApplicationBriefContextValidationError.REASON.FACET_NOT_IN_REQUIREMENT,
    ApplicationBriefContextValidationError.REASON.INCOMPLETE_REQUIREMENT_COVERAGE,
    ApplicationBriefContextValidationError.REASON
      .MISSING_SUPPORTED_CLAIMS_WITH_POSITIVE_EVIDENCE,
  ];
  for (const reason of reasons) {
    const cause = new ApplicationBriefContextValidationError(reason);
    const expected = new ApplicationBriefMatcherError(
      ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
      ApplicationBriefMatcherError.REASON.INVALID_CONTEXTUAL_OUTPUT,
      cause,
    );
    const harness = createHarness({ builderError: expected });
    await assert.rejects(harness.service.generateForOffer(REQUESTED_OFFER_ID), (error) => {
      return error === expected;
    });
    assert.deepEqual(harness.calls.logs.map(JSON.parse), [{
      event: "application_brief_semantic_matcher_invalid_output",
      validationCode: "CONTEXTUAL_VALIDATION",
      validationSubcode: reason,
    }]);
    assert.deepEqual(harness.calls.sign, []);
  }
});

test("service logs only closed invalid-evidence resolution diagnostics", async () => {
  const cause = new ApplicationBriefContextValidationError(
    ApplicationBriefContextValidationError.REASON.INVALID_EVIDENCE_REFERENCE,
    {
      evidenceReferenceFailure: "INDEX_NOT_FOUND",
      evidenceKind: "PROJECT",
      evidenceFieldClass: "INDEXED",
      itemId: "private-item",
      field: "private-field",
      index: 1,
      value: "private-value",
      providerOutput: "private-output",
    },
  );
  const expected = new ApplicationBriefMatcherError(
    ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
    ApplicationBriefMatcherError.REASON.INVALID_CONTEXTUAL_OUTPUT,
    cause,
  );
  const harness = createHarness({ builderError: expected });

  await assert.rejects(harness.service.generateForOffer(REQUESTED_OFFER_ID), (error) => {
    return error === expected;
  });
  assert.deepEqual(harness.calls.logs.map(JSON.parse), [{
    event: "application_brief_semantic_matcher_invalid_output",
    validationCode: "CONTEXTUAL_VALIDATION",
    validationSubcode: "INVALID_EVIDENCE_REFERENCE",
    evidenceReferenceFailure: "INDEX_NOT_FOUND",
    evidenceKind: "PROJECT",
    evidenceFieldClass: "INDEXED",
  }]);
  for (const forbidden of [
    "private-item", "private-field", "private-value", "private-output", "index",
  ]) {
    assert.equal(harness.calls.logs[0].includes(forbidden), false);
  }
});

test("service logs provider HTTP failures once with re-sanitized closed details", async () => {
  const cases = [
    [HTTP_BAD_REQUEST, "invalid_request_error", "invalid_json_schema"],
    [HTTP_SERVER_ERROR, "server_error", "provider_failure"],
  ];
  for (const [status, providerType, providerCode] of cases) {
    const cause = new GroqJsonClientError(GroqJsonClientError.CODE.HTTP_ERROR, {
      status,
      providerType,
      providerCode,
      ...NULL_RATE_LIMIT_DETAILS,
    });
    const expected = new ApplicationBriefMatcherError(
      ApplicationBriefMatcherError.CODE.PROVIDER_ERROR,
      null,
      cause,
    );
    const causeSnapshot = structuredClone(cause.safeDetails);
    const harness = createHarness({ builderError: expected });

    await assert.rejects(harness.service.generateForOffer(REQUESTED_OFFER_ID), (error) => {
      return error === expected;
    });
    assert.deepEqual(harness.calls.logs.map(JSON.parse), [{
      event: "application_brief_semantic_matcher_provider_error",
      status,
      providerType,
      providerCode,
      ...NULL_RATE_LIMIT_DETAILS,
    }]);
    assert.deepEqual(cause.safeDetails, causeSnapshot);
  }
});

test("service logs terminal provider classes with closed typed rate-limit details", async () => {
  const cases = [
    [
      ApplicationBriefMatcherError.CODE.RATE_LIMITED,
      GroqJsonClientError.CODE.RATE_LIMITED,
      { status: 429, ...RATE_LIMIT_DETAILS },
      { status: 429, providerType: null, providerCode: null },
    ],
    [
      ApplicationBriefMatcherError.CODE.PROVIDER_ERROR,
      GroqJsonClientError.CODE.HTTP_ERROR,
      {
        status: HTTP_BAD_REQUEST,
        providerType: "invalid_request_error",
        providerCode: "json_validate_failed",
        ...RATE_LIMIT_DETAILS,
      },
      {
        status: HTTP_BAD_REQUEST,
        providerType: "invalid_request_error",
        providerCode: "json_validate_failed",
      },
    ],
    [
      ApplicationBriefMatcherError.CODE.PROVIDER_TOKEN_BUDGET,
      GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED,
      { limitTokens: 10000, requestedTokens: 11000, ...RATE_LIMIT_DETAILS },
      { status: 413, providerType: "tokens", providerCode: "rate_limit_exceeded" },
    ],
    [
      ApplicationBriefMatcherError.CODE.PROVIDER_ERROR,
      GroqJsonClientError.CODE.HTTP_ERROR,
      {
        status: HTTP_SERVER_ERROR,
        providerType: "server_error",
        providerCode: "provider_failure",
        ...RATE_LIMIT_DETAILS,
      },
      {
        status: HTTP_SERVER_ERROR,
        providerType: "server_error",
        providerCode: "provider_failure",
      },
    ],
    [
      ApplicationBriefMatcherError.CODE.UNAVAILABLE,
      GroqJsonClientError.CODE.UNAVAILABLE,
      { status: HTTP_SERVER_ERROR, ...RATE_LIMIT_DETAILS },
      { status: HTTP_SERVER_ERROR, providerType: null, providerCode: null },
    ],
    [
      ApplicationBriefMatcherError.CODE.TIMEOUT,
      GroqJsonClientError.CODE.TIMEOUT,
      RATE_LIMIT_DETAILS,
      { status: null, providerType: null, providerCode: null },
    ],
  ];
  for (const [matcherCode, transportCode, safeDetails, expectedHttp] of cases) {
    const cause = new GroqJsonClientError(transportCode, {
      ...safeDetails,
      unknown: "private unknown",
      message: "private provider message",
      rawHeaders: { authorization: "private authorization" },
      failed_generation: "private raw output",
      candidate: "private candidate",
      offer: "private offer",
      prompt: "private prompt",
    });
    const expected = new ApplicationBriefMatcherError(matcherCode, null, cause);
    const harness = createHarness({ builderError: expected });

    await assert.rejects(harness.service.generateForOffer(REQUESTED_OFFER_ID), (error) => {
      return error === expected;
    });
    assert.deepEqual(harness.calls.logs.map(JSON.parse), [{
      event: "application_brief_semantic_matcher_provider_error",
      ...expectedHttp,
      ...RATE_LIMIT_DETAILS,
    }]);
    for (const forbidden of [
      "unknown", "private", "message", "rawHeaders", "authorization",
      "failed_generation", "candidate", "offer", "prompt",
    ]) {
      assert.equal(harness.calls.logs[0].includes(forbidden), false);
    }
  }
});

test("service does not misreport a local headroom skip as a provider response", async () => {
  const expected = new ApplicationBriefMatcherError(
    ApplicationBriefMatcherError.CODE.RATE_LIMITED,
    ApplicationBriefMatcherError.REASON.RATE_LIMIT_HEADROOM_SKIP,
  );
  const harness = createHarness({ builderError: expected });

  await assert.rejects(harness.service.generateForOffer(REQUESTED_OFFER_ID), (error) => {
    return error === expected;
  });
  assert.deepEqual(harness.calls.logs, []);
});

test("service neutralizes malformed provider details and an absent typed cause", async () => {
  const malformedCause = new GroqJsonClientError(GroqJsonClientError.CODE.HTTP_ERROR);
  malformedCause.safeDetails = {
    status: "400",
    providerType: "unsafe provider text",
    providerCode: { private: true },
  };
  const errors = [
    new ApplicationBriefMatcherError(
      ApplicationBriefMatcherError.CODE.PROVIDER_ERROR,
      null,
      malformedCause,
    ),
    new ApplicationBriefMatcherError(ApplicationBriefMatcherError.CODE.PROVIDER_ERROR),
  ];
  for (const expected of errors) {
    const harness = createHarness({ builderError: expected });
    await assert.rejects(harness.service.generateForOffer(REQUESTED_OFFER_ID), (error) => {
      return error === expected;
    });
    assert.deepEqual(harness.calls.logs.map(JSON.parse), [{
      event: "application_brief_semantic_matcher_provider_error",
      status: null,
      providerType: null,
      providerCode: null,
      ...NULL_RATE_LIMIT_DETAILS,
    }]);
  }
});

test("service rejects safe-looking metadata from a non-Groq cause", async () => {
  const fakeCause = new Error("synthetic non-provider cause");
  fakeCause.safeDetails = {
    status: HTTP_BAD_REQUEST,
    providerType: "safe_looking_type",
    providerCode: "safe_looking_code",
  };
  const expected = new ApplicationBriefMatcherError(
    ApplicationBriefMatcherError.CODE.PROVIDER_ERROR,
    null,
    fakeCause,
  );
  const harness = createHarness({ builderError: expected });

  await assert.rejects(harness.service.generateForOffer(REQUESTED_OFFER_ID), (error) => {
    return error === expected;
  });
  assert.deepEqual(harness.calls.logs.map(JSON.parse), [{
    event: "application_brief_semantic_matcher_provider_error",
    status: null,
    providerType: null,
    providerCode: null,
    ...NULL_RATE_LIMIT_DETAILS,
  }]);
});

test("service rejects safe-looking metadata from a non-HTTP Groq error", async () => {
  const cause = new GroqJsonClientError(GroqJsonClientError.CODE.INVALID_RESPONSE, {
    status: HTTP_BAD_REQUEST,
    providerType: "safe_looking_type",
    providerCode: "safe_looking_code",
  });
  const expected = new ApplicationBriefMatcherError(
    ApplicationBriefMatcherError.CODE.PROVIDER_ERROR,
    null,
    cause,
  );
  const harness = createHarness({ builderError: expected });

  await assert.rejects(harness.service.generateForOffer(REQUESTED_OFFER_ID), (error) => {
    return error === expected;
  });
  assert.deepEqual(harness.calls.logs.map(JSON.parse), [{
    event: "application_brief_semantic_matcher_provider_error",
    status: null,
    providerType: null,
    providerCode: null,
    ...NULL_RATE_LIMIT_DETAILS,
  }]);
});

test("service leaves non-provider failures unlogged", async () => {
  const errors = [
    new ApplicationBriefContextValidationError(
      ApplicationBriefContextValidationError.REASON.STALE_INPUT,
    ),
    new ApplicationBriefContextValidationError(
      ApplicationBriefContextValidationError.REASON.EVIDENCE_VALUE_MISMATCH,
    ),
  ];
  for (const expected of errors) {
    const harness = createHarness({ builderError: expected });
    await assert.rejects(harness.service.generateForOffer(REQUESTED_OFFER_ID), (error) => {
      return error === expected;
    });
    assert.deepEqual(harness.calls.logs, []);
  }
});

test("logger failure never masks terminal invalid output", async () => {
  const expected = new ApplicationBriefMatcherError(
    ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
    ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT,
    null,
    { validationCode: "SEMANTIC_VALIDATION", validationSubcode: "TYPE" },
  );
  const harness = createHarness({
    builderError: expected,
    loggerError: new Error("private logger failure"),
  });
  await assert.rejects(harness.service.generateForOffer(REQUESTED_OFFER_ID), (error) => {
    return error === expected;
  });
  assert.equal(harness.calls.logs.length, 1);
});

test("logger failure never masks terminal provider error", async () => {
  const expected = new ApplicationBriefMatcherError(
    ApplicationBriefMatcherError.CODE.PROVIDER_ERROR,
    null,
    new GroqJsonClientError(GroqJsonClientError.CODE.HTTP_ERROR, {
      status: HTTP_BAD_REQUEST,
      providerType: "invalid_request_error",
      providerCode: "invalid_json_schema",
    }),
  );
  const harness = createHarness({
    builderError: expected,
    loggerError: new Error("private logger failure"),
  });
  await assert.rejects(harness.service.generateForOffer(REQUESTED_OFFER_ID), (error) => {
    return error === expected;
  });
  assert.equal(harness.calls.logs.length, 1);
});
