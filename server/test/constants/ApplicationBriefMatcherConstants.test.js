import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationBriefMatcherConstants } from "../../src/constants/ApplicationBriefMatcherConstants.js";

test("matcher policy and bounded execution constants are exact", () => {
  assert.equal(ApplicationBriefMatcherConstants.POLICY_VERSION, "application-brief-matcher-v1");
  assert.equal(ApplicationBriefMatcherConstants.MAX_INPUT_CHARACTERS, 100000);
  assert.equal(ApplicationBriefMatcherConstants.MAX_OUTPUT_TOKENS, 4096);
  assert.equal(ApplicationBriefMatcherConstants.MINIMUM_RETRY_OUTPUT_TOKENS, 2048);
  assert.equal(ApplicationBriefMatcherConstants.TOKEN_BUDGET_SAFETY_MARGIN, 1);
  assert.equal(ApplicationBriefMatcherConstants.TOKEN_BUDGET_HTTP_STATUS, 413);
  assert.equal(ApplicationBriefMatcherConstants.TOKEN_BUDGET_PROVIDER_TYPE, "tokens");
  assert.equal(
    ApplicationBriefMatcherConstants.TOKEN_BUDGET_PROVIDER_CODE,
    "rate_limit_exceeded",
  );
  assert.equal(ApplicationBriefMatcherConstants.TOKEN_BUDGET_RETRY_REASON, "TOKEN_BUDGET_413");
  assert.equal(
    ApplicationBriefMatcherConstants.CROSS_CLASS_RETRY_REASON,
    "JSON_VALIDATE_FAILED_AFTER_TOKEN_BUDGET_413",
  );
  assert.equal(ApplicationBriefMatcherConstants.RETRY_ATTEMPT, 2);
  assert.equal(ApplicationBriefMatcherConstants.FINAL_CROSS_CLASS_RETRY_ATTEMPT, 3);
  assert.equal(ApplicationBriefMatcherConstants.TIMEOUT_MS, 30000);
});
