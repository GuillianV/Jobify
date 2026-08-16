import test from "node:test";
import assert from "node:assert/strict";
import { CoverLetterConstants } from "../../src/constants/CoverLetterConstants.js";
import { CoverLetterLimits } from "../../src/constants/CoverLetterLimits.js";
import { CoverLetter } from "../../src/models/CoverLetter.js";
import { CoverLetterOutputValidator } from "../../src/services/CoverLetterOutputValidator.js";

const SECOND_CLAIM_INDEX = 1 + 1;
const INVALID_FRACTIONAL_INDEX = 1 / SECOND_CLAIM_INDEX;

/**
 * Build one valid generated output.
 * @param {number} [length] - Exact letter length.
 * @returns {object} Valid output.
 */
function createOutput(length = CoverLetterLimits.MINIMUM_LETTER_LENGTH) {
  return { letter: "L".repeat(length), usedClaimIndexes: [SECOND_CLAIM_INDEX, 0] };
}

/**
 * Require one output candidate to fail structural validation.
 * @param {unknown} candidate - Invalid output.
 * @returns {void}
 */
function expectInvalid(candidate) {
  assert.throws(() => {
    new CoverLetterOutputValidator().validate(candidate);
  }, TypeError);
}

test("validator returns the detached normative CoverLetter without rewriting output", () => {
  const output = createOutput();
  output.letter = ` ${output.letter.slice(1)}`;
  const snapshot = structuredClone(output);
  const result = new CoverLetterOutputValidator().validate(output);

  assert.equal(result instanceof CoverLetter, true);
  assert.deepEqual(output, snapshot);
  assert.equal(result.letter, snapshot.letter);
  assert.deepEqual(result.usedClaimIndexes, [SECOND_CLAIM_INDEX, 0]);
  assert.equal(result.schemaVersion, CoverLetterConstants.SCHEMA_VERSION);
});

test("letter accepts exact bounds and rejects invalid text lengths or types", () => {
  assert.equal(new CoverLetterOutputValidator().validate(
    createOutput(CoverLetterLimits.MINIMUM_LETTER_LENGTH),
  ) instanceof CoverLetter, true);
  assert.equal(new CoverLetterOutputValidator().validate(
    createOutput(CoverLetterLimits.MAXIMUM_LETTER_LENGTH),
  ) instanceof CoverLetter, true);

  for (const letter of [
    "L".repeat(CoverLetterLimits.MINIMUM_LETTER_LENGTH - 1),
    "L".repeat(CoverLetterLimits.MAXIMUM_LETTER_LENGTH + 1),
    " ".repeat(CoverLetterLimits.MINIMUM_LETTER_LENGTH),
    null,
  ]) {
    expectInvalid({ letter, usedClaimIndexes: [0] });
  }
});

test("root keys are exact required and limited to one plain object", () => {
  const missing = createOutput();
  delete missing.usedClaimIndexes;
  const unknown = { ...createOutput(), reasoning: "private" };
  const nullPrototype = Object.assign(Object.create(null), createOutput());

  for (const candidate of [null, [], missing, unknown, nullPrototype]) {
    expectInvalid(candidate);
  }
});

test("used claim indexes must be non-empty unique safe integers in range shape", () => {
  for (const usedClaimIndexes of [
    [], [0, 0], [-1], [INVALID_FRACTIONAL_INDEX],
    [Number.MAX_SAFE_INTEGER + 1], ["0"], null,
  ]) {
    expectInvalid({ letter: createOutput().letter, usedClaimIndexes });
  }
  assert.deepEqual(
    new CoverLetterOutputValidator().validate(createOutput()).usedClaimIndexes,
    [SECOND_CLAIM_INDEX, 0],
  );
});

test("used claim indexes enforce the ApplicationBrief supported-claim cardinality", () => {
  const tooMany = Array.from(
    { length: CoverLetterLimits.MAXIMUM_USED_CLAIM_INDEXES + 1 },
    (_, index) => {
      return index;
    },
  );
  expectInvalid({ letter: createOutput().letter, usedClaimIndexes: tooMany });
});
