import test from "node:test";
import assert from "node:assert/strict";
import { OfferAnalysisConstants } from "../../src/constants/OfferAnalysisConstants.js";
import { OfferAnalysisLimits } from "../../src/constants/OfferAnalysisLimits.js";
import { OfferAnalysisNormalizer } from "../../src/services/OfferAnalysisNormalizer.js";
import { OfferAnalysisValidationError } from "../../src/services/OfferAnalysisValidationError.js";
import { OfferAnalysisValidator } from "../../src/services/OfferAnalysisValidator.js";

const SOURCE_TEXT = [
  "Nous recherchons Java.",
  "Travail en équipe agile.",
  "Mener les tests.",
  "Mode hybride.",
  "Élodie.",
].join(" ");
const JAVA_EVIDENCE = "Nous recherchons Java.";
const TEAM_EVIDENCE = "Travail en équipe agile.";
const ACTIVITY_EVIDENCE = "Mener les tests.";
const WORK_MODE_EVIDENCE = "Mode hybride.";
const UNICODE_EVIDENCE = "Élodie.";

/**
 * Create a validator with the production normalization policy.
 * @returns {OfferAnalysisValidator} Configured validator.
 */
function createValidator() {
  return new OfferAnalysisValidator(new OfferAnalysisNormalizer());
}

/**
 * Build a minimal valid OfferAnalysis candidate.
 * @returns {object} Valid raw analysis.
 */
function createMinimalAnalysis() {
  return {
    seniority: null,
    activities: [
      {
        value: "Développer en Java",
        assertion: OfferAnalysisConstants.ASSERTION.EXPLICIT,
        evidence: { text: JAVA_EVIDENCE },
      },
    ],
    requirements: [],
    context: [],
    workConditions: {
      workMode: null,
      constraints: [],
    },
  };
}

/**
 * Build one explicit activity with a shared exact proof.
 * @param {string} value - Synthetic activity value.
 * @returns {object} Activity item.
 */
function createActivity(value) {
  return {
    value,
    assertion: OfferAnalysisConstants.ASSERTION.EXPLICIT,
    evidence: { text: JAVA_EVIDENCE },
  };
}

/**
 * Build one explicit requirement.
 * @param {string} value - Synthetic requirement value.
 * @param {string} [category] - Requirement category.
 * @param {string} [importance] - Requirement importance.
 * @returns {object} Requirement item.
 */
function createRequirement(
  value,
  category = OfferAnalysisConstants.REQUIREMENT_CATEGORY.TOOL_OR_TECHNOLOGY,
  importance = OfferAnalysisConstants.REQUIREMENT_IMPORTANCE.REQUIRED,
) {
  return {
    category,
    value,
    importance,
    assertion: OfferAnalysisConstants.ASSERTION.EXPLICIT,
    evidence: { text: JAVA_EVIDENCE },
  };
}

/**
 * Build one explicit categorized semantic item.
 * @param {string} category - Context or constraint category.
 * @param {string} value - Synthetic value.
 * @returns {object} Categorized item.
 */
function createCategorizedItem(category, value) {
  return {
    category,
    value,
    assertion: OfferAnalysisConstants.ASSERTION.EXPLICIT,
    evidence: { text: TEAM_EVIDENCE },
  };
}

test("minimal OfferAnalysis validates and is detached from its input", () => {
  const candidate = createMinimalAnalysis();
  const before = structuredClone(candidate);
  const analysis = createValidator().validate(candidate, SOURCE_TEXT);
  candidate.activities[0].value = "Changed";

  assert.deepEqual(before, createMinimalAnalysis());
  assert.equal(analysis.activities[0].value, "Développer en Java");
  assert.deepEqual(analysis.toJson(), before);
});

test("OfferAnalysis toJson returns a deeply independent value", () => {
  const candidate = createMinimalAnalysis();
  candidate.requirements = [createRequirement("Java")];
  candidate.workConditions.workMode = {
    mode: OfferAnalysisConstants.WORK_MODE.HYBRID,
    detail: "Travail hybride",
    assertion: OfferAnalysisConstants.ASSERTION.EXPLICIT,
    evidence: { text: WORK_MODE_EVIDENCE },
  };
  const analysis = createValidator().validate(candidate, SOURCE_TEXT);
  const json = analysis.toJson();
  json.activities[0].value = "Changed activity";
  json.requirements[0].evidence.text = "Changed evidence";
  json.workConditions.workMode.detail = "Changed detail";
  json.workConditions.constraints.push(
    createCategorizedItem(OfferAnalysisConstants.CONSTRAINT_CATEGORY.TRAVEL, "Travel"),
  );

  const unchanged = analysis.toJson();
  assert.equal(unchanged.activities[0].value, "Développer en Java");
  assert.equal(unchanged.requirements[0].evidence.text, JAVA_EVIDENCE);
  assert.equal(unchanged.workConditions.workMode.detail, "Travail hybride");
  assert.deepEqual(unchanged.workConditions.constraints, []);
});

test("empty analysis and unknown root properties are rejected", () => {
  const empty = createMinimalAnalysis();
  empty.activities = [];
  assert.throws(() => {
    createValidator().validate(empty, SOURCE_TEXT);
  }, /semantic information/u);

  const unknown = createMinimalAnalysis();
  unknown.summary = "Forbidden";
  assert.throws(() => {
    createValidator().validate(unknown, SOURCE_TEXT);
  }, /unknown properties/u);
});

test("contract violations use the dedicated TypeError subtype", () => {
  let captured;
  try {
    createValidator().validate([], SOURCE_TEXT);
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof OfferAnalysisValidationError);
  assert.ok(captured instanceof TypeError);
});

test("invalid enums and malformed absence are rejected", () => {
  const invalidAssertion = createMinimalAnalysis();
  invalidAssertion.activities[0].assertion = "CERTAIN";
  assert.throws(() => {
    createValidator().validate(invalidAssertion, SOURCE_TEXT);
  }, /assertion/u);

  const invalidCategory = createMinimalAnalysis();
  invalidCategory.activities = [];
  invalidCategory.requirements = [createRequirement("Java", "INVALID")];
  assert.throws(() => {
    createValidator().validate(invalidCategory, SOURCE_TEXT);
  }, /category/u);

  const missingCollection = createMinimalAnalysis();
  missingCollection.context = null;
  assert.throws(() => {
    createValidator().validate(missingCollection, SOURCE_TEXT);
  }, /array/u);
});

test("collection and aggregate bounds are enforced", () => {
  const tooManyActivities = createMinimalAnalysis();
  tooManyActivities.activities = Array.from(
    { length: OfferAnalysisLimits.MAXIMUM_ACTIVITIES + 1 },
    (value, index) => {
      return createActivity(`Activity ${index}`);
    },
  );
  assert.throws(() => {
    createValidator().validate(tooManyActivities, SOURCE_TEXT);
  }, /too many items/u);

  const tooManyTotal = createMinimalAnalysis();
  tooManyTotal.activities = Array.from(
    { length: OfferAnalysisLimits.MAXIMUM_ACTIVITIES },
    (value, index) => {
      return createActivity(`Activity ${index}`);
    },
  );
  tooManyTotal.requirements = Array.from(
    { length: OfferAnalysisLimits.MAXIMUM_REQUIREMENTS },
    (value, index) => {
      return createRequirement(`Requirement ${index}`);
    },
  );
  tooManyTotal.context = Array.from(
    { length: OfferAnalysisLimits.MAXIMUM_CONTEXT_ITEMS },
    (value, index) => {
      return createCategorizedItem(
        OfferAnalysisConstants.CONTEXT_CATEGORY.TEAM,
        `Context ${index}`,
      );
    },
  );
  tooManyTotal.workConditions.constraints = Array.from(
    { length: OfferAnalysisLimits.MAXIMUM_CONSTRAINTS },
    (value, index) => {
      return {
        ...createCategorizedItem(
          OfferAnalysisConstants.CONSTRAINT_CATEGORY.OPERATIONAL,
          `Constraint ${index}`,
        ),
        evidence: { text: JAVA_EVIDENCE },
      };
    },
  );
  tooManyTotal.seniority = {
    levels: [OfferAnalysisConstants.SENIORITY_LEVEL.SENIOR],
    assertion: OfferAnalysisConstants.ASSERTION.EXPLICIT,
    evidence: { text: JAVA_EVIDENCE },
  };
  assert.throws(() => {
    createValidator().validate(tooManyTotal, SOURCE_TEXT);
  }, /too many semantic items/u);
});

test("value detail and evidence String.length limits are enforced", () => {
  const longValue = createMinimalAnalysis();
  longValue.activities[0].value = "a".repeat(OfferAnalysisLimits.MAXIMUM_VALUE_LENGTH + 1);
  assert.throws(() => {
    createValidator().validate(longValue, SOURCE_TEXT);
  }, /too long/u);

  const longDetail = createMinimalAnalysis();
  longDetail.activities = [];
  longDetail.workConditions.workMode = {
    mode: OfferAnalysisConstants.WORK_MODE.HYBRID,
    detail: "a".repeat(OfferAnalysisLimits.MAXIMUM_DETAIL_LENGTH + 1),
    assertion: OfferAnalysisConstants.ASSERTION.EXPLICIT,
    evidence: { text: WORK_MODE_EVIDENCE },
  };
  assert.throws(() => {
    createValidator().validate(longDetail, SOURCE_TEXT);
  }, /too long/u);

  const longEvidence = createMinimalAnalysis();
  longEvidence.activities[0].evidence.text = "a".repeat(
    OfferAnalysisLimits.MAXIMUM_EVIDENCE_LENGTH + 1,
  );
  assert.throws(() => {
    createValidator().validate(longEvidence, SOURCE_TEXT);
  }, /Evidence text is too long/u);
});

test("explicit evidence is mandatory exact and globally invalidating", () => {
  const missing = createMinimalAnalysis();
  missing.activities[0].evidence = null;
  assert.throws(() => {
    createValidator().validate(missing, SOURCE_TEXT);
  }, /evidence must be an object/u);

  const absent = createMinimalAnalysis();
  absent.activities[0].evidence.text = "Java is mandatory";
  assert.throws(() => {
    createValidator().validate(absent, SOURCE_TEXT);
  }, /not found/u);
});

test("inferred evidence rules and explicit-only families are enforced", () => {
  const inferredWithEvidence = createMinimalAnalysis();
  inferredWithEvidence.activities[0].assertion = OfferAnalysisConstants.ASSERTION.INFERRED;
  assert.throws(() => {
    createValidator().validate(inferredWithEvidence, SOURCE_TEXT);
  }, /must be null/u);

  const inferredActivity = createMinimalAnalysis();
  inferredActivity.activities[0].assertion = OfferAnalysisConstants.ASSERTION.INFERRED;
  inferredActivity.activities[0].evidence = null;
  assert.equal(
    createValidator().validate(inferredActivity, SOURCE_TEXT).activities[0].evidence,
    null,
  );

  const inferredRequirement = createMinimalAnalysis();
  inferredRequirement.activities = [];
  inferredRequirement.requirements = [createRequirement("Java")];
  inferredRequirement.requirements[0].assertion = OfferAnalysisConstants.ASSERTION.INFERRED;
  inferredRequirement.requirements[0].evidence = null;
  assert.throws(() => {
    createValidator().validate(inferredRequirement, SOURCE_TEXT);
  }, /must be explicit/u);

  const inferredWorkMode = createMinimalAnalysis();
  inferredWorkMode.activities = [];
  inferredWorkMode.workConditions.workMode = {
    mode: OfferAnalysisConstants.WORK_MODE.HYBRID,
    detail: null,
    assertion: OfferAnalysisConstants.ASSERTION.INFERRED,
    evidence: null,
  };
  assert.throws(() => {
    createValidator().validate(inferredWorkMode, SOURCE_TEXT);
  }, /must be explicit/u);

  const inferredConstraint = createMinimalAnalysis();
  inferredConstraint.activities = [];
  inferredConstraint.workConditions.constraints = [{
    ...createCategorizedItem(OfferAnalysisConstants.CONSTRAINT_CATEGORY.TRAVEL, "Travel"),
    assertion: OfferAnalysisConstants.ASSERTION.INFERRED,
    evidence: null,
  }];
  assert.throws(() => {
    createValidator().validate(inferredConstraint, SOURCE_TEXT);
  }, /must be explicit/u);
});

test("Unicode evidence remains exact and is never normalized", () => {
  const candidate = createMinimalAnalysis();
  candidate.activities[0] = {
    value: "  Échange   avec Élodie  ",
    assertion: OfferAnalysisConstants.ASSERTION.EXPLICIT,
    evidence: { text: UNICODE_EVIDENCE },
  };
  const analysis = createValidator().validate(candidate, SOURCE_TEXT);

  assert.equal(analysis.activities[0].value, "Échange avec Élodie");
  assert.equal(analysis.activities[0].evidence.text, UNICODE_EVIDENCE);

  const differentUnicode = createMinimalAnalysis();
  differentUnicode.activities[0].evidence.text = "Élodie.";
  assert.throws(() => {
    createValidator().validate(differentUnicode, SOURCE_TEXT);
  }, /not found/u);
});

test("normalization deduplicates lightly without erasing category or importance", () => {
  const candidate = createMinimalAnalysis();
  candidate.activities = [
    createActivity("  Développer   une API  "),
    createActivity("developper une api"),
  ];
  candidate.requirements = [
    createRequirement(" JÁVA "),
    createRequirement("java"),
    createRequirement(
      "Java",
      OfferAnalysisConstants.REQUIREMENT_CATEGORY.TECHNICAL_SKILL,
    ),
    createRequirement(
      "Java",
      OfferAnalysisConstants.REQUIREMENT_CATEGORY.TOOL_OR_TECHNOLOGY,
      OfferAnalysisConstants.REQUIREMENT_IMPORTANCE.PREFERRED,
    ),
  ];
  const analysis = createValidator().validate(candidate, SOURCE_TEXT);

  assert.deepEqual(analysis.activities.map((item) => {
    return item.value;
  }), ["Développer une API"]);
  assert.equal(analysis.requirements.length, candidate.requirements.length - 1);
  assert.equal(analysis.requirements[0].value, "JÁVA");
});

test("activity deduplication preserves explicit and inferred factuality in both orders", () => {
  const variants = [
    [
      {
        value: "Mener les tests",
        assertion: OfferAnalysisConstants.ASSERTION.INFERRED,
        evidence: null,
      },
      {
        value: "mener les tests",
        assertion: OfferAnalysisConstants.ASSERTION.EXPLICIT,
        evidence: { text: ACTIVITY_EVIDENCE },
      },
    ],
    [
      {
        value: "Mener les tests",
        assertion: OfferAnalysisConstants.ASSERTION.EXPLICIT,
        evidence: { text: ACTIVITY_EVIDENCE },
      },
      {
        value: "mener les tests",
        assertion: OfferAnalysisConstants.ASSERTION.INFERRED,
        evidence: null,
      },
    ],
  ];
  for (const activities of variants) {
    const candidate = createMinimalAnalysis();
    candidate.activities = activities;
    const analysis = createValidator().validate(candidate, SOURCE_TEXT);
    assert.deepEqual(new Set(analysis.activities.map((item) => {
      return item.assertion;
    })), new Set(Object.values(OfferAnalysisConstants.ASSERTION)));
  }

  const duplicate = createMinimalAnalysis();
  duplicate.activities = [
    createActivity("Mener les tests"),
    createActivity("mener les tests"),
  ];
  assert.equal(createValidator().validate(duplicate, SOURCE_TEXT).activities.length, 1);
});

test("context deduplication preserves assertion and category distinctions", () => {
  const inferred = {
    category: OfferAnalysisConstants.CONTEXT_CATEGORY.TEAM,
    value: "Équipe agile",
    assertion: OfferAnalysisConstants.ASSERTION.INFERRED,
    evidence: null,
  };
  const explicit = {
    category: OfferAnalysisConstants.CONTEXT_CATEGORY.TEAM,
    value: "équipe agile",
    assertion: OfferAnalysisConstants.ASSERTION.EXPLICIT,
    evidence: { text: TEAM_EVIDENCE },
  };
  for (const context of [[inferred, explicit], [explicit, inferred]]) {
    const candidate = createMinimalAnalysis();
    candidate.context = context;
    const analysis = createValidator().validate(candidate, SOURCE_TEXT);
    assert.equal(analysis.context.length, context.length);
  }

  const categories = createMinimalAnalysis();
  categories.context = [
    explicit,
    {
      ...explicit,
      category: OfferAnalysisConstants.CONTEXT_CATEGORY.DOMAIN,
    },
  ];
  assert.equal(
    createValidator().validate(categories, SOURCE_TEXT).context.length,
    categories.context.length,
  );

  const duplicate = createMinimalAnalysis();
  duplicate.context = [explicit, { ...explicit, value: "EQUIPE AGILE" }];
  assert.equal(createValidator().validate(duplicate, SOURCE_TEXT).context.length, 1);
});

test("seniority accepts several unique levels and rejects more than three", () => {
  const candidate = createMinimalAnalysis();
  candidate.activities = [];
  candidate.seniority = {
    levels: [
      OfferAnalysisConstants.SENIORITY_LEVEL.CONFIRMED,
      OfferAnalysisConstants.SENIORITY_LEVEL.SENIOR,
      OfferAnalysisConstants.SENIORITY_LEVEL.SENIOR,
    ],
    assertion: OfferAnalysisConstants.ASSERTION.INFERRED,
    evidence: null,
  };
  const analysis = createValidator().validate(candidate, SOURCE_TEXT);
  assert.deepEqual(analysis.seniority.levels, [
    OfferAnalysisConstants.SENIORITY_LEVEL.CONFIRMED,
    OfferAnalysisConstants.SENIORITY_LEVEL.SENIOR,
  ]);

  const tooMany = createMinimalAnalysis();
  tooMany.activities = [];
  tooMany.seniority = {
    levels: Object.values(OfferAnalysisConstants.SENIORITY_LEVEL).slice(
      0,
      OfferAnalysisLimits.MAXIMUM_SENIORITY_LEVELS + 1,
    ),
    assertion: OfferAnalysisConstants.ASSERTION.INFERRED,
    evidence: null,
  };
  assert.throws(() => {
    createValidator().validate(tooMany, SOURCE_TEXT);
  }, /too many items/u);
});

test("work mode null detail and every constraint category validate", () => {
  const candidate = createMinimalAnalysis();
  candidate.activities = [];
  candidate.workConditions.workMode = {
    mode: OfferAnalysisConstants.WORK_MODE.HYBRID,
    detail: null,
    assertion: OfferAnalysisConstants.ASSERTION.EXPLICIT,
    evidence: { text: WORK_MODE_EVIDENCE },
  };
  candidate.workConditions.constraints = Object.values(
    OfferAnalysisConstants.CONSTRAINT_CATEGORY,
  ).map((category) => {
    return {
      ...createCategorizedItem(category, category),
      evidence: { text: TEAM_EVIDENCE },
    };
  });

  const analysis = createValidator().validate(candidate, SOURCE_TEXT);
  assert.equal(analysis.workConditions.workMode.detail, null);
  assert.deepEqual(analysis.workConditions.constraints.map((item) => {
    return item.category;
  }), Object.values(OfferAnalysisConstants.CONSTRAINT_CATEGORY));
});
