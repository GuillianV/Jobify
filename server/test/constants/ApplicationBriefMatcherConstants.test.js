import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationBriefMatcherConstants } from "../../src/constants/ApplicationBriefMatcherConstants.js";

test("matcher policy and bounded execution constants are exact", () => {
  assert.equal(ApplicationBriefMatcherConstants.POLICY_VERSION, "application-brief-matcher-v1");
  assert.equal(ApplicationBriefMatcherConstants.MAX_INPUT_CHARACTERS, 100000);
  assert.equal(ApplicationBriefMatcherConstants.MAX_OUTPUT_TOKENS, 4096);
  assert.equal(ApplicationBriefMatcherConstants.MINIMUM_RETRY_OUTPUT_TOKENS, 2048);
  assert.equal(ApplicationBriefMatcherConstants.TOKEN_BUDGET_SAFETY_MARGIN, 1);
  assert.equal(ApplicationBriefMatcherConstants.TIMEOUT_MS, 30000);
});
