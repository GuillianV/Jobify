import test from "node:test";
import assert from "node:assert/strict";
import { OfferContentAcquisition } from "../../src/constants/OfferContentAcquisition.js";
import { OfferContentCompleteness } from "../../src/constants/OfferContentCompleteness.js";
import { OfferContentEvaluationConstants } from "../../src/constants/OfferContentEvaluationConstants.js";
import { OfferContent } from "../../src/models/OfferContent.js";
import { OfferContentEvaluator } from "../../src/services/OfferContentEvaluator.js";

const RETRIEVED_AT = "2026-08-10T10:00:00.000Z";
const PROVIDED_AT = "2026-08-10T11:00:00.000Z";
const LOW_CHARACTER_COUNT = 300;
const BELOW_LOW_CHARACTER_COUNT = 299;
const LOW_WORD_COUNT = 40;
const BELOW_LOW_WORD_COUNT = 39;
const LOW_DISTINCT_WORD_COUNT = 30;
const BELOW_LOW_DISTINCT_WORD_COUNT = 29;
const HIGH_CHARACTER_COUNT = 800;
const BELOW_HIGH_CHARACTER_COUNT = 799;
const HIGH_WORD_COUNT = 120;
const HIGH_DISTINCT_WORD_COUNT = 80;
const INTERMEDIATE_CHARACTER_COUNT = 500;
const INTERMEDIATE_WORD_COUNT = 70;
const INTERMEDIATE_DISTINCT_WORD_COUNT = 55;
const SHORT_CAREERJET_CHARACTER_COUNT = 200;
const SHORT_CAREERJET_WORD_COUNT = 30;
const SHORT_CAREERJET_DISTINCT_WORD_COUNT = 25;
const RICH_CAREERJET_CHARACTER_COUNT = 3000;
const RICH_CAREERJET_WORD_COUNT = 450;
const RICH_CAREERJET_DISTINCT_WORD_COUNT = 220;
const RICH_HELLOWORK_CHARACTER_COUNT = 2800;
const RICH_HELLOWORK_WORD_COUNT = 385;
const RICH_HELLOWORK_DISTINCT_WORD_COUNT = 167;
const REPETITION_PREFIX_WORD_COUNT = 90;
const REPETITION_COUNT = 100;
const REPETITION_GRAM_SIZE = 5;
const EXACT_REPETITION_BLOCK_WORD_COUNT = 14;
const TOKEN_PADDING_WIDTH = 3;
const TOKEN_REPEAT_STEP = 37;
const EXPECTED_NORMALIZED_CHARACTER_COUNT = 1;
const REPETITION_THRESHOLD = 0.8;
const EXPECTED_UNICODE_WORD_COUNT = 10;
const EXPECTED_UNICODE_DISTINCT_WORD_COUNT = 8;
const EXPECTED_NON_BMP_CODE_POINT_COUNT = 3;
const EXPECTED_NON_BMP_UTF16_UNIT_COUNT = 4;
const EXPECTED_COLLAPSED_CHARACTER_COUNT = 22;
const EXPECTED_COLLAPSED_WORD_COUNT = 4;

const evaluator = new OfferContentEvaluator();

/**
 * Build text with exact character, word and distinct-word counts.
 * @param {number} characterCount - Exact normalized character count.
 * @param {number} wordCount - Exact token count.
 * @param {number} distinctWordCount - Exact distinct-token count.
 * @returns {string} Synthetic text satisfying all requested metrics.
 */
function buildMetricText(characterCount, wordCount, distinctWordCount) {
  const distinctWords = Array.from({ length: distinctWordCount }, (_, index) => {
    return `m${String(index).padStart(TOKEN_PADDING_WIDTH, "0")}`;
  });
  const words = [...distinctWords];
  const repeatableWordCount = distinctWordCount - 1;
  for (let index = distinctWordCount; index < wordCount; index += 1) {
    const repeatIndex = ((index - distinctWordCount) * TOKEN_REPEAT_STEP)
      % repeatableWordCount;
    words.push(distinctWords[repeatIndex]);
  }
  const currentLength = words.join(" ").length;
  if (currentLength > characterCount) {
    throw new Error("Synthetic metric target is too short for its word counts");
  }
  words[distinctWordCount - 1] += "x".repeat(characterCount - currentLength);
  return words.join(" ");
}

/**
 * Build normalized automatic offer content.
 * @param {string} value - Provider text.
 * @param {string} [completeness] - Technical completeness metadata.
 * @param {string} [acquisition] - Acquisition channel metadata.
 * @returns {OfferContent} Content with automatic text.
 */
function automaticContent(
  value,
  completeness = OfferContentCompleteness.UNKNOWN,
  acquisition = OfferContentAcquisition.SEARCH,
) {
  return new OfferContent({
    automaticText: {
      value,
      acquisition,
      completeness,
      retrievedAt: RETRIEVED_AT,
    },
  });
}

/**
 * Build content containing both automatic and user text.
 * @param {string} automaticValue - Provider text.
 * @param {string} userValue - Explicit user text.
 * @returns {OfferContent} Content whose effective source is USER.
 */
function userContent(automaticValue, userValue) {
  return new OfferContent({
    automaticText: {
      value: automaticValue,
      acquisition: OfferContentAcquisition.DETAIL,
      completeness: OfferContentCompleteness.PROVIDER_FULL,
      retrievedAt: RETRIEVED_AT,
    },
    userText: {
      value: userValue,
      providedAt: PROVIDED_AT,
    },
  });
}

test("missing and whitespace-only content return the fixed NONE evaluation", () => {
  const empty = evaluator.evaluate(new OfferContent());
  const whitespace = evaluator.evaluate(automaticContent("   \n\t  "));
  const expectedMetrics = {
    characterCount: 0,
    wordCount: 0,
    distinctWordCount: 0,
    repeatedFiveGramShare: 0,
    textSource: OfferContentEvaluationConstants.TEXT_SOURCE.NONE,
    acquisition: null,
    completeness: null,
  };

  assert.deepEqual(empty.metrics, expectedMetrics);
  assert.deepEqual(whitespace.metrics, expectedMetrics);
  assert.deepEqual(empty.reasons, [OfferContentEvaluationConstants.REASON.MISSING_TEXT]);
  assert.equal(empty.status, OfferContentEvaluationConstants.STATUS.INSUFFICIENT);
});

test("analysis normalizes Unicode NFC and whitespace without changing stored text", () => {
  const storedText = "  e\u0301  ";
  const content = automaticContent(storedText);
  const result = evaluator.evaluate(content);

  assert.equal(result.metrics.characterCount, EXPECTED_NORMALIZED_CHARACTER_COUNT);
  assert.equal(result.metrics.wordCount, EXPECTED_NORMALIZED_CHARACTER_COUNT);
  assert.equal(result.metrics.distinctWordCount, EXPECTED_NORMALIZED_CHARACTER_COUNT);
  assert.equal(content.getAutomaticText(), storedText);
});

test("public metrics tokenize Unicode letters and numbers across documented separators", () => {
  const text = "École école 123 l'emploi d’emploi savoir-faire, qualité! €";
  const result = evaluator.evaluate(automaticContent(text));

  assert.equal(result.metrics.wordCount, EXPECTED_UNICODE_WORD_COUNT);
  assert.equal(
    result.metrics.distinctWordCount,
    EXPECTED_UNICODE_DISTINCT_WORD_COUNT,
  );
});

test("characterCount uses Unicode code points instead of UTF-16 units", () => {
  const text = "a\u{1D400}b";
  const result = evaluator.evaluate(automaticContent(text));

  assert.equal(text.length, EXPECTED_NON_BMP_UTF16_UNIT_COUNT);
  assert.equal(result.metrics.characterCount, EXPECTED_NON_BMP_CODE_POINT_COUNT);
});

test("metric whitespace normalization collapses internal runs without mutating content", () => {
  const text = "alpha   beta\tgamma\r\ndelta";
  const content = automaticContent(text);
  const result = evaluator.evaluate(content);

  assert.equal(result.metrics.characterCount, EXPECTED_COLLAPSED_CHARACTER_COUNT);
  assert.equal(result.metrics.wordCount, EXPECTED_COLLAPSED_WORD_COUNT);
  assert.equal(result.metrics.distinctWordCount, EXPECTED_COLLAPSED_WORD_COUNT);
  assert.equal(content.getAutomaticText(), text);
});

test("each strict lower bound independently produces TOO_SHORT", () => {
  const cases = [
    buildMetricText(BELOW_LOW_CHARACTER_COUNT, LOW_WORD_COUNT, LOW_DISTINCT_WORD_COUNT),
    buildMetricText(LOW_CHARACTER_COUNT, BELOW_LOW_WORD_COUNT, LOW_DISTINCT_WORD_COUNT),
    buildMetricText(LOW_CHARACTER_COUNT, LOW_WORD_COUNT, BELOW_LOW_DISTINCT_WORD_COUNT),
  ];

  for (const text of cases) {
    const result = evaluator.evaluate(automaticContent(text));
    assert.equal(result.status, OfferContentEvaluationConstants.STATUS.INSUFFICIENT);
    assert.deepEqual(result.reasons, [OfferContentEvaluationConstants.REASON.TOO_SHORT]);
  }
});

test("the exact lower bounds are not TOO_SHORT and remain UNDETERMINED", () => {
  const text = buildMetricText(
    LOW_CHARACTER_COUNT,
    LOW_WORD_COUNT,
    LOW_DISTINCT_WORD_COUNT,
  );
  const result = evaluator.evaluate(automaticContent(text));

  assert.equal(result.status, OfferContentEvaluationConstants.STATUS.UNDETERMINED);
  assert.deepEqual(result.reasons, [
    OfferContentEvaluationConstants.REASON.INTERMEDIATE_CONTENT,
  ]);
});

test("each missed upper bound remains UNDETERMINED and the exact bounds are SUFFICIENT", () => {
  const belowTexts = [
    buildMetricText(BELOW_HIGH_CHARACTER_COUNT, HIGH_WORD_COUNT, HIGH_DISTINCT_WORD_COUNT),
    buildMetricText(HIGH_CHARACTER_COUNT, HIGH_WORD_COUNT - 1, HIGH_DISTINCT_WORD_COUNT),
    buildMetricText(HIGH_CHARACTER_COUNT, HIGH_WORD_COUNT, HIGH_DISTINCT_WORD_COUNT - 1),
  ];
  const exact = evaluator.evaluate(automaticContent(buildMetricText(
    HIGH_CHARACTER_COUNT,
    HIGH_WORD_COUNT,
    HIGH_DISTINCT_WORD_COUNT,
  )));

  for (const belowText of belowTexts) {
    const below = evaluator.evaluate(automaticContent(belowText));
    assert.equal(below.status, OfferContentEvaluationConstants.STATUS.UNDETERMINED);
  }
  assert.equal(exact.status, OfferContentEvaluationConstants.STATUS.SUFFICIENT);
  assert.deepEqual(exact.reasons, [
    OfferContentEvaluationConstants.REASON.SUFFICIENT_TEXT_VOLUME,
  ]);
});

test("an Adzuna-like intermediate fixture is UNDETERMINED", () => {
  const result = evaluator.evaluate(automaticContent(
    buildMetricText(
      INTERMEDIATE_CHARACTER_COUNT,
      INTERMEDIATE_WORD_COUNT,
      INTERMEDIATE_DISTINCT_WORD_COUNT,
    ),
    OfferContentCompleteness.KNOWN_TRUNCATED,
  ));

  assert.equal(result.status, OfferContentEvaluationConstants.STATUS.UNDETERMINED);
});

test("exact placeholders tolerate case, whitespace, apostrophe type and terminal punctuation", () => {
  const placeholders = [
    "description non disponible",
    "description indisponible",
    "contenu non disponible",
    "contenu indisponible",
    "  VOIR   L’ANNONCE!!!  ",
    "consulter l'annonce",
    "voir l'offre",
    "Consulter l'offre.",
    "cliquez ici pour voir l'annonce;",
  ];

  for (const placeholder of placeholders) {
    const result = evaluator.evaluate(automaticContent(placeholder));
    assert.equal(result.status, OfferContentEvaluationConstants.STATUS.INSUFFICIENT);
    assert.deepEqual(result.reasons, [
      OfferContentEvaluationConstants.REASON.TOO_SHORT,
      OfferContentEvaluationConstants.REASON.PLACEHOLDER_CONTENT,
    ]);
  }
});

test("placeholder vocabulary is not matched as a substring of rich text", () => {
  const richText = buildMetricText(
    HIGH_CHARACTER_COUNT,
    HIGH_WORD_COUNT,
    HIGH_DISTINCT_WORD_COUNT,
  );
  const result = evaluator.evaluate(automaticContent(
    `Voir l'annonce pour découvrir les missions et les compétences requises. ${richText}`,
  ));

  assert.equal(result.status, OfferContentEvaluationConstants.STATUS.SUFFICIENT);
  assert.equal(
    result.reasons.includes(OfferContentEvaluationConstants.REASON.PLACEHOLDER_CONTENT),
    false,
  );
});

test("massively repeated five-grams are measured and rejected", () => {
  const prefix = Array.from({ length: REPETITION_PREFIX_WORD_COUNT }, (_, index) => {
    return `unique${index}`;
  });
  const repeatedGram = prefix.slice(0, REPETITION_GRAM_SIZE);
  const repeated = Array.from({ length: REPETITION_COUNT }, () => {
    return repeatedGram.join(" ");
  });
  const result = evaluator.evaluate(automaticContent(`${prefix.join(" ")} ${repeated.join(" ")}`));

  assert.equal(
    result.metrics.repeatedFiveGramShare
      >= OfferContentEvaluationConstants.HIGH_REPETITION_SHARE,
    true,
  );
  assert.equal(result.status, OfferContentEvaluationConstants.STATUS.INSUFFICIENT);
  assert.deepEqual(result.reasons, [
    OfferContentEvaluationConstants.REASON.HIGHLY_REPETITIVE,
  ]);
});

test("exactly eighty percent repeated five-gram positions are rejected", () => {
  const block = Array.from({ length: EXACT_REPETITION_BLOCK_WORD_COUNT }, (_, index) => {
    return `block${index}`;
  });
  const text = `${block.join(" ")} separator ${block.join(" ")}`;
  const result = evaluator.evaluate(automaticContent(text));

  assert.equal(result.metrics.repeatedFiveGramShare, REPETITION_THRESHOLD);
  assert.equal(result.status, OfferContentEvaluationConstants.STATUS.INSUFFICIENT);
  assert.equal(
    result.reasons.includes(OfferContentEvaluationConstants.REASON.HIGHLY_REPETITIVE),
    true,
  );
});

test("multiple insufficient reasons retain their stable order", () => {
  const repeatedShortText = "a ".repeat(REPETITION_COUNT).trim();
  const result = evaluator.evaluate(automaticContent(repeatedShortText));

  assert.deepEqual(result.reasons, [
    OfferContentEvaluationConstants.REASON.TOO_SHORT,
    OfferContentEvaluationConstants.REASON.HIGHLY_REPETITIVE,
  ]);
});

test("ordinary repeated vocabulary stays below the repetition threshold", () => {
  const result = evaluator.evaluate(automaticContent(buildMetricText(
    HIGH_CHARACTER_COUNT,
    HIGH_WORD_COUNT,
    HIGH_DISTINCT_WORD_COUNT,
  )));

  assert.equal(result.metrics.repeatedFiveGramShare < REPETITION_THRESHOLD, true);
  assert.equal(result.status, OfferContentEvaluationConstants.STATUS.SUFFICIENT);
});

test("fewer than five tokens always produce a finite zero repetition share", () => {
  const result = evaluator.evaluate(automaticContent("alpha beta gamma delta"));

  assert.equal(result.metrics.repeatedFiveGramShare, 0);
  assert.equal(Number.isFinite(result.metrics.repeatedFiveGramShare), true);
});

test("exactly five tokens produce one unique five-gram and a zero share", () => {
  const result = evaluator.evaluate(automaticContent("alpha beta gamma delta epsilon"));

  assert.equal(result.metrics.wordCount, REPETITION_GRAM_SIZE);
  assert.equal(result.metrics.repeatedFiveGramShare, 0);
});

test("user text overrides richer automatic text without inheriting its metadata", () => {
  const rich = buildMetricText(HIGH_CHARACTER_COUNT, HIGH_WORD_COUNT, HIGH_DISTINCT_WORD_COUNT);
  const result = evaluator.evaluate(userContent(rich, "contenu bref"));

  assert.equal(result.status, OfferContentEvaluationConstants.STATUS.INSUFFICIENT);
  assert.equal(result.metrics.textSource, OfferContentEvaluationConstants.TEXT_SOURCE.USER);
  assert.equal(result.metrics.acquisition, null);
  assert.equal(result.metrics.completeness, null);
});

test("rich user text overrides poor automatic text under the same policy", () => {
  const rich = buildMetricText(HIGH_CHARACTER_COUNT, HIGH_WORD_COUNT, HIGH_DISTINCT_WORD_COUNT);
  const result = evaluator.evaluate(userContent("contenu bref", rich));

  assert.equal(result.status, OfferContentEvaluationConstants.STATUS.SUFFICIENT);
  assert.equal(result.metrics.textSource, OfferContentEvaluationConstants.TEXT_SOURCE.USER);
});

test("invalid empty user text follows OfferContent fallback semantics", () => {
  const rich = buildMetricText(HIGH_CHARACTER_COUNT, HIGH_WORD_COUNT, HIGH_DISTINCT_WORD_COUNT);
  const content = userContent(rich, "   ");
  const result = evaluator.evaluate(content);

  assert.equal(content.userText, null);
  assert.equal(result.status, OfferContentEvaluationConstants.STATUS.SUFFICIENT);
  assert.equal(result.metrics.textSource, OfferContentEvaluationConstants.TEXT_SOURCE.AUTOMATIC);
});

test("automatic text exposes only its own acquisition and completeness", () => {
  const rich = buildMetricText(HIGH_CHARACTER_COUNT, HIGH_WORD_COUNT, HIGH_DISTINCT_WORD_COUNT);
  const result = evaluator.evaluate(automaticContent(
    rich,
    OfferContentCompleteness.UNKNOWN,
    OfferContentAcquisition.DETAIL,
  ));

  assert.equal(result.metrics.textSource, OfferContentEvaluationConstants.TEXT_SOURCE.AUTOMATIC);
  assert.equal(result.metrics.acquisition, OfferContentAcquisition.DETAIL);
  assert.equal(result.metrics.completeness, OfferContentCompleteness.UNKNOWN);
});

test("completeness never directly decides sufficiency", () => {
  const rich = buildMetricText(HIGH_CHARACTER_COUNT, HIGH_WORD_COUNT, HIGH_DISTINCT_WORD_COUNT);
  const poorFull = evaluator.evaluate(automaticContent(
    "texte trop bref",
    OfferContentCompleteness.PROVIDER_FULL,
  ));
  const richTruncated = evaluator.evaluate(automaticContent(
    rich,
    OfferContentCompleteness.KNOWN_TRUNCATED,
  ));
  const richUnknown = evaluator.evaluate(automaticContent(
    rich,
    OfferContentCompleteness.UNKNOWN,
  ));

  assert.equal(poorFull.status, OfferContentEvaluationConstants.STATUS.INSUFFICIENT);
  assert.equal(richTruncated.status, OfferContentEvaluationConstants.STATUS.SUFFICIENT);
  assert.equal(richUnknown.status, OfferContentEvaluationConstants.STATUS.SUFFICIENT);
});

test("representative provider-shaped fixtures follow content volume only", () => {
  const fixtures = [
    {
      name: "France Travail rich",
      text: buildMetricText(HIGH_CHARACTER_COUNT, HIGH_WORD_COUNT, HIGH_DISTINCT_WORD_COUNT),
      completeness: OfferContentCompleteness.PROVIDER_FULL,
      acquisition: OfferContentAcquisition.SEARCH,
      status: OfferContentEvaluationConstants.STATUS.SUFFICIENT,
    },
    {
      name: "Careerjet short",
      text: buildMetricText(
        SHORT_CAREERJET_CHARACTER_COUNT,
        SHORT_CAREERJET_WORD_COUNT,
        SHORT_CAREERJET_DISTINCT_WORD_COUNT,
      ),
      completeness: OfferContentCompleteness.KNOWN_TRUNCATED,
      acquisition: OfferContentAcquisition.SEARCH,
      status: OfferContentEvaluationConstants.STATUS.INSUFFICIENT,
    },
    {
      name: "Careerjet rich",
      text: buildMetricText(
        RICH_CAREERJET_CHARACTER_COUNT,
        RICH_CAREERJET_WORD_COUNT,
        RICH_CAREERJET_DISTINCT_WORD_COUNT,
      ),
      completeness: OfferContentCompleteness.UNKNOWN,
      acquisition: OfferContentAcquisition.SEARCH,
      status: OfferContentEvaluationConstants.STATUS.SUFFICIENT,
    },
    {
      name: "HelloWork DETAIL rich",
      text: buildMetricText(
        RICH_HELLOWORK_CHARACTER_COUNT,
        RICH_HELLOWORK_WORD_COUNT,
        RICH_HELLOWORK_DISTINCT_WORD_COUNT,
      ),
      completeness: OfferContentCompleteness.PROVIDER_FULL,
      acquisition: OfferContentAcquisition.DETAIL,
      status: OfferContentEvaluationConstants.STATUS.SUFFICIENT,
    },
  ];

  for (const fixture of fixtures) {
    const result = evaluator.evaluate(automaticContent(
      fixture.text,
      fixture.completeness,
      fixture.acquisition,
    ));
    assert.equal(result.status, fixture.status, fixture.name);
  }

  const helloWorkSearch = evaluator.evaluate(new OfferContent());
  assert.equal(helloWorkSearch.status, OfferContentEvaluationConstants.STATUS.INSUFFICIENT);
  assert.deepEqual(helloWorkSearch.reasons, [
    OfferContentEvaluationConstants.REASON.MISSING_TEXT,
  ]);
});

test("evaluation is deterministic, returns fresh objects and never mutates OfferContent", () => {
  const content = automaticContent(buildMetricText(
    HIGH_CHARACTER_COUNT,
    HIGH_WORD_COUNT,
    HIGH_DISTINCT_WORD_COUNT,
  ));
  const before = content.toPersistenceJson();
  const first = evaluator.evaluate(content);
  const second = evaluator.evaluate(content);

  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.notEqual(first.reasons, second.reasons);
  assert.notEqual(first.metrics, second.metrics);
  assert.deepEqual(content.toPersistenceJson(), before);
});
