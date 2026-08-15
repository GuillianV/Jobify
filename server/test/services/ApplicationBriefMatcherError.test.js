import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationBriefMatcherError } from "../../src/services/ApplicationBriefMatcherError.js";

test("matcher error exposes only stable safe codes and the consumed semantic reason", () => {
  assert.deepEqual(Object.values(ApplicationBriefMatcherError.CODE), [
    "INVALID_APPLICATION_BRIEF_OUTPUT",
    "APPLICATION_BRIEF_INPUT_TOO_LARGE",
    "APPLICATION_BRIEF_UNAVAILABLE",
    "APPLICATION_BRIEF_TIMEOUT",
    "APPLICATION_BRIEF_RATE_LIMITED",
    "APPLICATION_BRIEF_PROVIDER_TOKEN_BUDGET",
    "APPLICATION_BRIEF_PROVIDER_ERROR",
  ]);
  assert.deepEqual(Object.values(ApplicationBriefMatcherError.REASON), [
    "INVALID_SEMANTIC_OUTPUT",
    "INVALID_CONTEXTUAL_OUTPUT",
  ]);
  const cause = new Error("private cause");
  const error = new ApplicationBriefMatcherError(
    ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
    ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT,
    cause,
  );
  assert.equal(error.message, "INVALID_APPLICATION_BRIEF_OUTPUT");
  assert.equal(error.cause, cause);
  assert.equal("safeDetails" in error, false);
});
