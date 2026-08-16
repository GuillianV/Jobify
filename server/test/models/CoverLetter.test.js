import test from "node:test";
import assert from "node:assert/strict";
import { CoverLetterConstants } from "../../src/constants/CoverLetterConstants.js";
import { CoverLetterLimits } from "../../src/constants/CoverLetterLimits.js";
import { CoverLetter } from "../../src/models/CoverLetter.js";

const SECOND_CLAIM_INDEX = 1 + 1;
const LETTER = "L".repeat(CoverLetterLimits.MINIMUM_LETTER_LENGTH);

test("CoverLetter adds its normative schema and preserves generated output order", () => {
  const output = { letter: LETTER, usedClaimIndexes: [SECOND_CLAIM_INDEX, 0] };
  const model = new CoverLetter(output);

  assert.deepEqual(model.toJson(), {
    schemaVersion: CoverLetterConstants.SCHEMA_VERSION,
    letter: LETTER,
    usedClaimIndexes: [SECOND_CLAIM_INDEX, 0],
  });
  assert.equal(Object.isFrozen(model), true);
  assert.equal(Object.isFrozen(model.usedClaimIndexes), true);
});

test("CoverLetter detaches constructor and toJson values", () => {
  const output = { letter: LETTER, usedClaimIndexes: [0] };
  const model = new CoverLetter(output);
  output.usedClaimIndexes.push(1);
  const detached = model.toJson();
  detached.usedClaimIndexes.push(SECOND_CLAIM_INDEX);

  assert.deepEqual(model.usedClaimIndexes, [0]);
  assert.deepEqual(model.toJson().usedClaimIndexes, [0]);
});

test("schema and generator policy versions remain deterministic and distinct", () => {
  assert.equal(CoverLetterConstants.SCHEMA_VERSION, "cover-letter-schema-v1");
  assert.equal(
    CoverLetterConstants.GENERATOR_POLICY_VERSION,
    "cover-letter-generator-v1",
  );
  assert.notEqual(
    CoverLetterConstants.SCHEMA_VERSION,
    CoverLetterConstants.GENERATOR_POLICY_VERSION,
  );
});
