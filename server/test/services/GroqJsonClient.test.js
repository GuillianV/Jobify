import test from "node:test";
import assert from "node:assert/strict";
import { GroqConstants } from "../../src/constants/GroqConstants.js";
import { GroqJsonClient } from "../../src/services/GroqJsonClient.js";
import { GroqJsonClientError } from "../../src/services/GroqJsonClientError.js";

const API_KEY = "private-api-key";
const ENDPOINT = "https://groq.invalid/chat";
const MODEL = "test-model";
const SYSTEM_PROMPT = "private system prompt";
const USER_PROMPT = "private user prompt";
const TIMEOUT = 30000;
const MAX_TOKENS = 4096;
const TIMER_ID = 7;
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_BAD_REQUEST = 400;
const HTTP_CONTENT_TOO_LARGE = 413;
const HTTP_RATE_LIMITED = 429;
const HTTP_SERVER_ERROR = 500;
const TOKEN_LIMIT = 12000;
const TOKEN_REQUESTED = 12047;
const UNSAFE_PROVIDER_METADATA_LENGTH = 81;
const UNSAFE_PROVIDER_METADATA_NUMBER = 42;
const REASONING_EFFORTS = ["low", "medium", "high"];

/**
 * Build one successful fetch response containing serialized message JSON.
 * @param {unknown} value - JSON value returned by the model.
 * @returns {object} Fetch response double.
 */
function createResponse(value) {
  return {
    ok: true,
    status: HTTP_OK,
    async json() {
      return { choices: [{ message: { content: JSON.stringify(value) } }] };
    },
  };
}

/**
 * Build one rejected fetch response with an isolated synthetic provider body.
 * @param {number} status - HTTP status.
 * @param {unknown} body - Synthetic response payload.
 * @returns {object} Fetch response double.
 */
function createErrorResponse(status, body) {
  return {
    ok: false,
    status,
    async json() {
      return structuredClone(body);
    },
  };
}

/**
 * Build standard completion arguments.
 * @returns {object} Completion arguments.
 */
function createRequest() {
  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: USER_PROMPT,
    model: MODEL,
    timeout: TIMEOUT,
    maxTokens: MAX_TOKENS,
  };
}

/**
 * Capture one rejected completion as a typed transport error.
 * @param {Promise<unknown>} promise - Rejected completion.
 * @returns {Promise<GroqJsonClientError>} Captured error.
 */
async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof GroqJsonClientError);
    return error;
  }
  assert.fail("Expected Groq completion to fail");
}

test("missing API key is unavailable and never calls fetch", async () => {
  let calls = 0;
  const client = new GroqJsonClient({
    apiKey: " ",
    fetchImpl: async () => {
      calls += 1;
      return createResponse({ valid: true });
    },
  });

  const error = await captureError(client.completeJson(createRequest()));
  assert.equal(error.code, GroqJsonClientError.CODE.UNAVAILABLE);
  assert.equal(calls, 0);
});

test("request uses strict Groq JSON mode and returns parsed values", async () => {
  let capturedEndpoint;
  let capturedOptions;
  let clearedTimer;
  const expected = { valid: true };
  const client = new GroqJsonClient({
    apiKey: API_KEY,
    endpoint: ENDPOINT,
    fetchImpl: async (endpoint, options) => {
      capturedEndpoint = endpoint;
      capturedOptions = options;
      return createResponse(expected);
    },
    setTimeoutImpl: () => {
      return TIMER_ID;
    },
    clearTimeoutImpl: (timer) => {
      clearedTimer = timer;
    },
  });

  assert.deepEqual(await client.completeJson(createRequest()), expected);
  assert.equal(capturedEndpoint, ENDPOINT);
  assert.equal(capturedOptions.method, "POST");
  assert.equal(capturedOptions.headers.Authorization, `Bearer ${API_KEY}`);
  assert.equal(capturedOptions.headers["Content-Type"], "application/json");
  assert.ok(capturedOptions.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(capturedOptions.body), {
    model: MODEL,
    temperature: GroqConstants.TEMPERATURE,
    max_tokens: MAX_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: USER_PROMPT },
    ],
  });
  assert.equal(Object.hasOwn(JSON.parse(capturedOptions.body), "reasoning_effort"), false);
  assert.equal(clearedTimer, TIMER_ID);

  const arrayClient = new GroqJsonClient({
    apiKey: API_KEY,
    fetchImpl: async () => {
      return createResponse(["not", "an", "object"]);
    },
  });
  assert.deepEqual(await arrayClient.completeJson(createRequest()), ["not", "an", "object"]);

  const primitiveClient = new GroqJsonClient({
    apiKey: API_KEY,
    fetchImpl: async () => {
      return createResponse("hello");
    },
  });
  assert.equal(await primitiveClient.completeJson(createRequest()), "hello");
});

test("request maps only closed opt-in reasoning efforts", async () => {
  const bodies = [];
  const client = new GroqJsonClient({
    apiKey: API_KEY,
    fetchImpl: async (endpoint, options) => {
      bodies.push(JSON.parse(options.body));
      return createResponse({ valid: true });
    },
  });

  for (const reasoningEffort of REASONING_EFFORTS) {
    await client.completeJson({ ...createRequest(), reasoningEffort });
  }
  assert.deepEqual(bodies.map((body) => {
    return body.reasoning_effort;
  }), REASONING_EFFORTS);
  assert.deepEqual(bodies[0], {
    model: MODEL,
    temperature: GroqConstants.TEMPERATURE,
    max_tokens: MAX_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: USER_PROMPT },
    ],
    reasoning_effort: "low",
  });

  let calls = 0;
  const rejectingClient = new GroqJsonClient({
    apiKey: API_KEY,
    fetchImpl: async () => {
      calls += 1;
      return createResponse({ valid: true });
    },
  });
  for (const reasoningEffort of ["", "LOW", "minimal", {}, [], 1]) {
    await assert.rejects(
      rejectingClient.completeJson({ ...createRequest(), reasoningEffort }),
      TypeError,
    );
  }
  assert.equal(calls, 0);
});

test("request accepts one detached strict JSON Schema response format", async () => {
  let capturedBody;
  const responseFormat = {
    type: "json_schema",
    json_schema: {
      name: "test_schema",
      strict: true,
      schema: {
        type: "object",
        properties: { valid: { type: "boolean" } },
        required: ["valid"],
        additionalProperties: false,
      },
    },
  };
  const original = structuredClone(responseFormat);
  const client = new GroqJsonClient({
    apiKey: API_KEY,
    fetchImpl: async (endpoint, options) => {
      capturedBody = JSON.parse(options.body);
      return createResponse({ valid: true });
    },
  });

  await client.completeJson({ ...createRequest(), responseFormat });

  assert.deepEqual(capturedBody.response_format, original);
  assert.deepEqual(responseFormat, original);
  assert.equal(capturedBody.model, MODEL);
  assert.equal(capturedBody.temperature, GroqConstants.TEMPERATURE);
  assert.equal(capturedBody.max_tokens, MAX_TOKENS);
  assert.deepEqual(capturedBody.messages, [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: USER_PROMPT },
  ]);
});

test("request rejects unsupported or exotic response formats before fetch", async () => {
  let calls = 0;
  const client = new GroqJsonClient({
    apiKey: API_KEY,
    fetchImpl: async () => {
      calls += 1;
      return createResponse({ valid: true });
    },
  });
  const invalidFormats = [
    null,
    [],
    { type: "json_object", extra: true },
    { type: "json_schema" },
    {
      type: "json_schema",
      json_schema: { name: "test", strict: false, schema: {} },
    },
    Object.create(null),
  ];

  for (const responseFormat of invalidFormats) {
    await assert.rejects(
      client.completeJson({ ...createRequest(), responseFormat }),
      TypeError,
    );
  }
  assert.equal(calls, 0);
});

test("timeout and network failures are classified and timers are cleared", async () => {
  let timeoutCleared;
  const timeoutClient = new GroqJsonClient({
    apiKey: API_KEY,
    setTimeoutImpl: (callback) => {
      callback();
      return TIMER_ID;
    },
    clearTimeoutImpl: (timer) => {
      timeoutCleared = timer;
    },
    fetchImpl: async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    },
  });
  const timeoutError = await captureError(timeoutClient.completeJson(createRequest()));
  assert.equal(timeoutError.code, GroqJsonClientError.CODE.TIMEOUT);
  assert.equal(timeoutCleared, TIMER_ID);

  let networkCleared;
  const networkClient = new GroqJsonClient({
    apiKey: API_KEY,
    fetchImpl: async () => {
      throw new TypeError("network private details");
    },
    setTimeoutImpl: () => {
      return TIMER_ID;
    },
    clearTimeoutImpl: (timer) => {
      networkCleared = timer;
    },
  });
  const networkError = await captureError(networkClient.completeJson(createRequest()));
  assert.equal(networkError.code, GroqJsonClientError.CODE.UNAVAILABLE);
  assert.equal(networkCleared, TIMER_ID);
});

test("local fetch configuration and programming errors are not transport failures", async () => {
  assert.throws(() => {
    return new GroqJsonClient({ apiKey: API_KEY, fetchImpl: null });
  }, (error) => {
    return error instanceof TypeError && !(error instanceof GroqJsonClientError);
  });

  const localError = new Error("local bug");
  const localClient = new GroqJsonClient({
    apiKey: API_KEY,
    fetchImpl: async () => {
      throw localError;
    },
  });
  await assert.rejects(localClient.completeJson(createRequest()), (error) => {
    return error === localError;
  });

  const externalAbortClient = new GroqJsonClient({
    apiKey: API_KEY,
    fetchImpl: async () => {
      const error = new Error("external abort");
      error.name = "AbortError";
      throw error;
    },
  });
  const abortError = await captureError(externalAbortClient.completeJson(createRequest()));
  assert.equal(abortError.code, GroqJsonClientError.CODE.UNAVAILABLE);
});

test("HTTP statuses have stable safe classifications", async () => {
  const cases = [
    [HTTP_UNAUTHORIZED, GroqJsonClientError.CODE.AUTHENTICATION_ERROR],
    [HTTP_FORBIDDEN, GroqJsonClientError.CODE.AUTHENTICATION_ERROR],
    [HTTP_RATE_LIMITED, GroqJsonClientError.CODE.RATE_LIMITED],
    [HTTP_BAD_REQUEST, GroqJsonClientError.CODE.HTTP_ERROR],
    [HTTP_SERVER_ERROR, GroqJsonClientError.CODE.HTTP_ERROR],
  ];
  for (const [status, expectedCode] of cases) {
    const client = new GroqJsonClient({
      apiKey: API_KEY,
      fetchImpl: async () => {
        return { ok: false, status };
      },
    });
    const error = await captureError(client.completeJson(createRequest()));
    assert.equal(error.code, expectedCode);
    const expectedDetails = expectedCode === GroqJsonClientError.CODE.HTTP_ERROR
      ? { status, providerType: null, providerCode: null }
      : { status };
    assert.deepEqual(error.safeDetails, expectedDetails);
  }
});

test("generic HTTP errors retain only validated provider identifiers", async () => {
  const sensitiveMessage = "synthetic message that must not be preserved";
  const client = new GroqJsonClient({
    apiKey: API_KEY,
    fetchImpl: async () => {
      return createErrorResponse(HTTP_BAD_REQUEST, {
        error: {
          message: sensitiveMessage,
          type: "invalid_request_error",
          code: "invalid_json_schema",
          unexpected: { anything: "must never escape" },
        },
      });
    },
  });

  const error = await captureError(client.completeJson(createRequest()));
  assert.equal(error.code, GroqJsonClientError.CODE.HTTP_ERROR);
  assert.deepEqual(error.safeDetails, {
    status: HTTP_BAD_REQUEST,
    providerType: "invalid_request_error",
    providerCode: "invalid_json_schema",
  });
  assert.equal(JSON.stringify(error).includes(sensitiveMessage), false);
  assert.equal(Object.hasOwn(error.safeDetails, "message"), false);
  assert.equal(Object.hasOwn(error.safeDetails, "body"), false);
  assert.equal(Object.hasOwn(error.safeDetails, "unexpected"), false);
});

test("generic HTTP errors reject unsafe provider metadata without truncation", async () => {
  const unsafeValues = [
    "free text",
    "line\nbreak",
    "prompt-like {content}",
    "x".repeat(UNSAFE_PROVIDER_METADATA_LENGTH),
    UNSAFE_PROVIDER_METADATA_NUMBER,
    { private: true },
  ];
  for (const unsafeValue of unsafeValues) {
    const client = new GroqJsonClient({
      apiKey: API_KEY,
      fetchImpl: async () => {
        return createErrorResponse(HTTP_BAD_REQUEST, {
          error: { type: unsafeValue, code: unsafeValue },
        });
      },
    });
    const error = await captureError(client.completeJson(createRequest()));
    assert.deepEqual(error.safeDetails, {
      status: HTTP_BAD_REQUEST,
      providerType: null,
      providerCode: null,
    });
  }
});

test("malformed empty and non-JSON error bodies never mask the HTTP failure", async () => {
  const bodies = [[], null, { error: "private" }, { error: [] }, {
    error: { type: UNSAFE_PROVIDER_METADATA_NUMBER, code: { private: true } },
  }];
  for (const body of bodies) {
    let reads = 0;
    const client = new GroqJsonClient({
      apiKey: API_KEY,
      fetchImpl: async () => {
        return {
          ok: false,
          status: HTTP_BAD_REQUEST,
          async json() {
            reads += 1;
            return structuredClone(body);
          },
        };
      },
    });
    const error = await captureError(client.completeJson(createRequest()));
    assert.equal(error.code, GroqJsonClientError.CODE.HTTP_ERROR);
    assert.deepEqual(error.safeDetails, {
      status: HTTP_BAD_REQUEST,
      providerType: null,
      providerCode: null,
    });
    assert.equal(reads, 1);
  }

  for (const bodyError of [new SyntaxError("invalid JSON"), new Error("empty body")]) {
    let reads = 0;
    const client = new GroqJsonClient({
      apiKey: API_KEY,
      fetchImpl: async () => {
        return {
          ok: false,
          status: HTTP_BAD_REQUEST,
          async json() {
            reads += 1;
            throw bodyError;
          },
        };
      },
    });
    const error = await captureError(client.completeJson(createRequest()));
    assert.equal(error.code, GroqJsonClientError.CODE.HTTP_ERROR);
    assert.deepEqual(error.safeDetails, {
      status: HTTP_BAD_REQUEST,
      providerType: null,
      providerCode: null,
    });
    assert.equal(reads, 1);
  }
});

test("recognized HTTP 413 token budgets expose only strict safe integers", async () => {
  const sensitiveSentinels = [
    "organization-secret",
    "prompt-secret",
    "candidate-secret",
  ];
  const message = [
    ...sensitiveSentinels,
    `Limit ${TOKEN_LIMIT}, Requested ${TOKEN_REQUESTED}`,
  ].join(" ");
  let bodyReads = 0;
  const client = new GroqJsonClient({
    apiKey: API_KEY,
    fetchImpl: async () => {
      return {
        ok: false,
        status: HTTP_CONTENT_TOO_LARGE,
        async json() {
          bodyReads += 1;
          return {
            error: {
              type: "tokens",
              code: "rate_limit_exceeded",
              message,
            },
          };
        },
      };
    },
  });

  const error = await captureError(client.completeJson(createRequest()));
  assert.equal(error.code, GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED);
  assert.deepEqual(error.safeDetails, {
    limitTokens: TOKEN_LIMIT,
    requestedTokens: TOKEN_REQUESTED,
  });
  assert.equal(bodyReads, 1);
  const exposable = JSON.stringify({
    code: error.code,
    safeDetails: error.safeDetails,
  });
  for (const sentinel of sensitiveSentinels) {
    assert.equal(exposable.includes(sentinel), false);
  }
});

test("unrecognized HTTP 413 reads its body once and retains generic behavior", async () => {
  let bodyReads = 0;
  const client = new GroqJsonClient({
    apiKey: API_KEY,
    fetchImpl: async () => {
      return {
        ok: false,
        status: HTTP_CONTENT_TOO_LARGE,
        async json() {
          bodyReads += 1;
          return {
            error: {
              type: "invalid_request_error",
              code: "context_limit",
              message: "synthetic raw provider message",
            },
          };
        },
      };
    },
  });

  const error = await captureError(client.completeJson(createRequest()));
  assert.equal(error.code, GroqJsonClientError.CODE.HTTP_ERROR);
  assert.deepEqual(error.safeDetails, {
    status: HTTP_CONTENT_TOO_LARGE,
    providerType: "invalid_request_error",
    providerCode: "context_limit",
  });
  assert.equal(bodyReads, 1);
});

test("unrecognized or incoherent HTTP 413 bodies retain generic HTTP behavior", async () => {
  const invalidBodies = [
    {},
    { error: { type: "other", code: "rate_limit_exceeded", message: "Limit 10, Requested 11" } },
    { error: { type: "tokens", code: "other", message: "Limit 10, Requested 11" } },
    { error: { type: "tokens", code: "rate_limit_exceeded" } },
    { error: { type: "tokens", code: "rate_limit_exceeded", message: "unknown" } },
    { error: { type: "tokens", code: "rate_limit_exceeded", message: "Requested 11" } },
    { error: { type: "tokens", code: "rate_limit_exceeded", message: "Limit 10" } },
    { error: { type: "tokens", code: "rate_limit_exceeded", message: "Limit ten, Requested 11" } },
    { error: { type: "tokens", code: "rate_limit_exceeded", message: "Limit 0, Requested 11" } },
    { error: { type: "tokens", code: "rate_limit_exceeded", message: "Limit -1, Requested 11" } },
    { error: { type: "tokens", code: "rate_limit_exceeded", message: "Limit 10, Requested 10" } },
    { error: { type: "tokens", code: "rate_limit_exceeded", message: "Limit 10, Requested 9" } },
    { error: { type: "tokens", code: "rate_limit_exceeded", message: "Limit 10.5, Requested 11" } },
    { error: { type: "tokens", code: "rate_limit_exceeded", message: "Limit 10, Requested 11.5" } },
    { error: { type: "tokens", code: "rate_limit_exceeded", message: "Limit 9007199254740992, Requested 9007199254740993" } },
    { error: { type: "tokens", code: "rate_limit_exceeded", message: "Limit 10, Requested 11; Limit 12, Requested 13" } },
    { error: { type: "tokens", code: "rate_limit_exceeded", message: "Limit 999 metadata. Limit 12000, Requested 12047" } },
    { error: { type: "tokens", code: "rate_limit_exceeded", message: "Requested 999 metadata. Limit 12000, Requested 12047" } },
    { error: { type: "tokens", code: "rate_limit_exceeded", message: "Limit 12000, Requested 12047. Limit 999 metadata" } },
    { error: { type: "tokens", code: "rate_limit_exceeded", message: "Limit 12000, Requested 12047. Requested 999 metadata" } },
  ];
  for (const body of invalidBodies) {
    const client = new GroqJsonClient({
      apiKey: API_KEY,
      fetchImpl: async () => {
        return createErrorResponse(HTTP_CONTENT_TOO_LARGE, body);
      },
    });
    const error = await captureError(client.completeJson(createRequest()));
    assert.equal(error.code, GroqJsonClientError.CODE.HTTP_ERROR);
    assert.deepEqual(
      error.safeDetails,
      GroqJsonClientError.createHttpSafeDetails(
        HTTP_CONTENT_TOO_LARGE,
        body?.error?.type,
        body?.error?.code,
      ),
    );
  }

  const unreadableClient = new GroqJsonClient({
    apiKey: API_KEY,
    fetchImpl: async () => {
      return {
        ok: false,
        status: HTTP_CONTENT_TOO_LARGE,
        async json() {
          throw new Error("private provider body");
        },
      };
    },
  });
  const unreadable = await captureError(unreadableClient.completeJson(createRequest()));
  assert.equal(unreadable.code, GroqJsonClientError.CODE.HTTP_ERROR);
  assert.deepEqual(unreadable.safeDetails, {
    status: HTTP_CONTENT_TOO_LARGE,
    providerType: null,
    providerCode: null,
  });
});

test("invalid envelopes and content are rejected without leaking content", async () => {
  const rawContent = "private raw provider body";
  const responses = [
    {
      ok: true,
      status: HTTP_OK,
      async json() {
        throw new Error(rawContent);
      },
    },
    {
      ok: true,
      status: HTTP_OK,
      async json() {
        return {};
      },
    },
    {
      ok: true,
      status: HTTP_OK,
      async json() {
        return { choices: [{}] };
      },
    },
    {
      ok: true,
      status: HTTP_OK,
      async json() {
        return { choices: [{ message: { content: " " } }] };
      },
    },
    {
      ok: true,
      status: HTTP_OK,
      async json() {
        return { choices: [{ message: { content: rawContent } }] };
      },
    },
  ];
  for (const response of responses) {
    const client = new GroqJsonClient({
      apiKey: API_KEY,
      fetchImpl: async () => {
        return response;
      },
    });
    const error = await captureError(client.completeJson(createRequest()));
    assert.equal(error.code, GroqJsonClientError.CODE.INVALID_RESPONSE);
    assert.equal(error.cause, undefined);
    const publicError = JSON.stringify({
      name: error.name,
      message: error.message,
      code: error.code,
      safeDetails: error.safeDetails,
    });
    for (const secret of [API_KEY, SYSTEM_PROMPT, USER_PROMPT, rawContent]) {
      assert.equal(publicError.includes(secret), false);
      assert.equal(JSON.stringify(error).includes(secret), false);
    }
  }
});
