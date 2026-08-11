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
const MAX_TOKENS = 8192;
const TIMER_ID = 7;
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_BAD_REQUEST = 400;
const HTTP_RATE_LIMITED = 429;
const HTTP_SERVER_ERROR = 500;

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
    assert.deepEqual(error.safeDetails, { status });
  }
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
