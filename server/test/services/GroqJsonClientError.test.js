import test from "node:test";
import assert from "node:assert/strict";
import { GroqJsonClientError } from "../../src/services/GroqJsonClientError.js";

const HTTP_RATE_LIMITED = 429;

/**
 * Verify direct error construction retains only the closed typed rate-limit contract.
 */
test("rate-limit errors reject arbitrary and malformed safeDetails fields", () => {
  const error = new GroqJsonClientError(GroqJsonClientError.CODE.RATE_LIMITED, {
    status: HTTP_RATE_LIMITED,
    rateLimitTokenLimit: 8000,
    rateLimitTokenRemaining: -1,
    rateLimitTokenResetMs: "7000",
    rateLimitRequestLimit: Number.MAX_SAFE_INTEGER + 1,
    rateLimitRequestRemaining: 0,
    rateLimitRequestResetMs: 5000,
    retryAfterMs: 1000,
    headers: { authorization: "secret" },
    arbitrary: "private",
  });

  assert.deepEqual(error.safeDetails, {
    status: HTTP_RATE_LIMITED,
    rateLimitTokenLimit: 8000,
    rateLimitTokenRemaining: null,
    rateLimitTokenResetMs: null,
    rateLimitRequestLimit: null,
    rateLimitRequestRemaining: 0,
    rateLimitRequestResetMs: 5000,
    retryAfterMs: 1000,
  });
  assert.equal(JSON.stringify(error.safeDetails).includes("secret"), false);
  assert.equal(JSON.stringify(error.safeDetails).includes("private"), false);
});
