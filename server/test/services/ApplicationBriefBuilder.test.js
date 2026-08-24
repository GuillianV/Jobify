import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationBriefLimits } from "../../src/constants/ApplicationBriefLimits.js";
import { ApplicationBriefMatcherConstants } from "../../src/constants/ApplicationBriefMatcherConstants.js";
import { CandidateDossier } from "../../src/models/CandidateDossier.js";
import { OfferAnalysis } from "../../src/models/OfferAnalysis.js";
import { ApplicationBrief } from "../../src/models/ApplicationBrief.js";
import { ApplicationBriefAssembler } from "../../src/services/ApplicationBriefAssembler.js";
import { ApplicationBriefBuilder } from "../../src/services/ApplicationBriefBuilder.js";
import { ApplicationBriefContextValidationError } from "../../src/services/ApplicationBriefContextValidationError.js";
import { ApplicationBriefContextValidator } from "../../src/services/ApplicationBriefContextValidator.js";
import { ApplicationBriefEvidenceResolver } from "../../src/services/ApplicationBriefEvidenceResolver.js";
import { ApplicationBriefInputProjector } from "../../src/services/ApplicationBriefInputProjector.js";
import { ApplicationBriefMatcherError } from "../../src/services/ApplicationBriefMatcherError.js";
import { ApplicationBriefOfferRefResolver } from "../../src/services/ApplicationBriefOfferRefResolver.js";
import { ApplicationBriefValidator } from "../../src/services/ApplicationBriefValidator.js";
import { ApplicationBriefValidationError } from "../../src/services/ApplicationBriefValidationError.js";
import { CandidateDossierValidationError } from "../../src/services/CandidateDossierValidationError.js";
import { CandidateDossierFingerprint } from "../../src/services/CandidateDossierFingerprint.js";

const OFFER_IDENTITY = Object.freeze({
  offerId: 1,
  analysisFingerprint: "a".repeat(ApplicationBriefLimits.SHA256_HEX_LENGTH),
  analysisSchemaVersion: "offer-analysis-schema-v1",
  analyzerPolicyVersion: "offer-analyzer-v5",
});
const EXPERIENCE_REF = Object.freeze({
  kind: "EXPERIENCE", itemId: "experience-1", field: "role",
});
const REDUCED_MAX_TOKENS = 3000;
const REQUEST_TOKEN_BUDGET = 9000;
const GREATER_TOKEN_HEADROOM = 10000;
const ACTIVE_RETRY_AFTER_MS = 1000;
const INITIAL_PROVIDER_CALLS = 2;
const REGENERATED_PHASE_COUNT = 2;

/**
 * Build one authoritative analysis with one React requirement.
 * @param {object} [overrides] - Analysis overrides.
 * @returns {OfferAnalysis} Offer fixture.
 */
function createAnalysis(overrides = {}) {
  return new OfferAnalysis({
    seniority: null,
    activities: [{ value: "Build products", assertion: "INFERRED", evidence: null }],
    requirements: [{
      category: "SKILL", value: "React", importance: "REQUIRED",
      assertion: "EXPLICIT", evidence: { text: "React" },
    }],
    context: [],
    workConditions: { workMode: null, constraints: [] },
    ...overrides,
  });
}

/**
 * Build one authoritative candidate dossier.
 * @returns {CandidateDossier} Candidate fixture.
 */
function createDossier() {
  return new CandidateDossier({
    schemaVersion: "candidate-dossier-schema-v1",
    experiences: [{
      id: "experience-1", role: "React Engineer", organization: "Org", client: null,
      startDate: "2024-01", endDate: null, current: true, domain: null,
      activities: [], achievements: [], technologies: ["React"],
    }],
    projects: [], skills: [], education: [], languages: [], softSkills: [],
  });
}

/**
 * Build one non-trivial valid semantic output.
 * @returns {object} Semantic output fixture.
 */
function createSemanticOutput() {
  return {
    requirementMatches: [{
      offerRef: { kind: "REQUIREMENT", index: 0 }, state: "SUPPORTED",
      supportedFacets: [{ text: "React", evidenceRefs: [EXPERIENCE_REF] }],
      notEvidencedFacets: [],
    }],
    emphasis: [{
      priority: "PRIMARY", offerRefs: [{ kind: "ACTIVITY", index: 0 }],
      evidenceRefs: [EXPERIENCE_REF], relevanceReason: "Relevant experience",
    }],
    supportedClaims: [{
      claimType: "EXPERIENCE_FACT", offerRefs: [{ kind: "REQUIREMENT", index: 0 }],
      evidenceRefs: [EXPERIENCE_REF],
    }],
    cautions: [{
      kind: "DURATION_UNSUPPORTED", offerRefs: [{ kind: "REQUIREMENT", index: 0 }],
      evidenceRefs: [EXPERIENCE_REF],
    }],
  };
}

/**
 * Build one exact execution envelope that permits one bounded local regeneration.
 * @param {object} [overrides] - Metadata overrides.
 * @returns {object} Internal execution metadata fixture.
 */
function createRetryableExecution(overrides = {}) {
  return {
    providerCallsMade: INITIAL_PROVIDER_CALLS,
    successfulMaxTokens: REDUCED_MAX_TOKENS,
    successfulRequestTokenBudget: REQUEST_TOKEN_BUDGET,
    rateLimitTokenRemaining: REQUEST_TOKEN_BUDGET,
    rateLimitRequestRemaining: 1,
    ...overrides,
  };
}

/**
 * Build an analysis and semantic output with two exactly covered requirements.
 * @returns {{analysis: OfferAnalysis, semanticOutput: object}} Complete coverage fixtures.
 */
function createTwoRequirementFixtures() {
  const secondRequirement = {
    category: "SKILL", value: "Vue", importance: "OPTIONAL",
    assertion: "EXPLICIT", evidence: { text: "Vue" },
  };
  const analysis = createAnalysis({
    requirements: [...createAnalysis().requirements, secondRequirement],
  });
  const semanticOutput = createSemanticOutput();
  semanticOutput.requirementMatches.push({
    offerRef: { kind: "REQUIREMENT", index: 1 }, state: "NOT_EVIDENCED",
    supportedFacets: [], notEvidencedFacets: [{ text: "Vue" }],
  });
  return { analysis, semanticOutput };
}

/**
 * Create real deterministic builder dependencies around one fake matcher.
 * @param {object} semanticOutput - Matcher result.
 * @param {object} [overrides] - Dependency overrides.
 * @returns {{builder: ApplicationBriefBuilder, projections: object[], assembler: ApplicationBriefAssembler}} Builder harness.
 */
function createHarness(semanticOutput, overrides = {}) {
  const projections = [];
  const sessions = [];
  const logs = [];
  const matcherResults = overrides.matcherResults ?? [{
    semanticOutput,
    providerExecution: {
      providerCallsMade: 1,
      successfulMaxTokens: ApplicationBriefMatcherConstants.MAX_OUTPUT_TOKENS,
    },
  }];
  const inputProjector = new ApplicationBriefInputProjector();
  const assembler = new ApplicationBriefAssembler({
    evidenceResolver: new ApplicationBriefEvidenceResolver(),
    candidateFingerprint: CandidateDossierFingerprint,
  });
  const contextValidator = new ApplicationBriefContextValidator({
    applicationBriefValidator: new ApplicationBriefValidator(),
    offerRefResolver: new ApplicationBriefOfferRefResolver(),
    evidenceResolver: new ApplicationBriefEvidenceResolver(),
    candidateFingerprint: CandidateDossierFingerprint,
  });
  const builder = new ApplicationBriefBuilder({
    inputProjector,
    semanticMatcher: {
      async matchWithExecution(projection, session) {
        projections.push(structuredClone(projection));
        sessions.push(session === undefined ? undefined : structuredClone(session));
        const result = matcherResults[projections.length - 1];
        if (result instanceof Error) {
          throw result;
        }
        return structuredClone(result);
      },
    },
    assembler: overrides.assembler ?? assembler,
    contextValidator: overrides.contextValidator ?? contextValidator,
    logger: overrides.logger ?? {
      warn(value) {
        logs.push(JSON.parse(value));
      },
    },
  });
  return { builder, projections, sessions, logs, assembler };
}

test("builder returns immutable final brief and sends only the minimal projection", async () => {
  const analysis = createAnalysis();
  const dossier = createDossier();
  const snapshot = { title: "React Engineer" };
  const harness = createHarness(createSemanticOutput());
  const brief = await harness.builder.build({
    offerAnalysis: analysis,
    offerSnapshot: snapshot,
    offerIdentity: OFFER_IDENTITY,
    candidateDossier: dossier,
  });

  assert.equal(brief instanceof ApplicationBrief, true);
  assert.equal(Object.isFrozen(brief), true);
  assert.equal(harness.projections.length, 1);
  assert.deepEqual(harness.projections[0], new ApplicationBriefInputProjector().project({
    offerAnalysis: analysis, offerSnapshot: snapshot, candidateDossier: dossier,
  }));
  assert.equal("offerIdentity" in harness.projections[0], false);
  assert.equal("inputIdentity" in harness.projections[0], false);
  assert.equal(brief.evidenceFacts[0].value, "React Engineer");
  const detached = brief.toJson();
  assert.equal(Object.hasOwn(brief, "providerExecution"), false);
  assert.equal(Object.hasOwn(detached, "providerExecution"), false);
  detached.requirementMatches[0].supportedFacets[0].text = "Changed";
  assert.equal(brief.requirementMatches[0].supportedFacets[0].text, "React");
});

test("bounded retry repairs incomplete coverage with retained budget and one global call", async () => {
  const fixtures = createTwoRequirementFixtures();
  const harness = createHarness(createSemanticOutput(), {
    matcherResults: [{
      semanticOutput: createSemanticOutput(),
      providerExecution: createRetryableExecution(),
    }, {
      semanticOutput: fixtures.semanticOutput,
      providerExecution: createRetryableExecution({ providerCallsMade: 3 }),
    }],
  });

  const brief = await harness.builder.build({
    offerAnalysis: fixtures.analysis, offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
    candidateDossier: createDossier(),
  });

  assert.equal(brief.requirementMatches.length, REGENERATED_PHASE_COUNT);
  assert.equal(Object.hasOwn(brief, "providerExecution"), false);
  assert.equal(Object.hasOwn(brief.toJson(), "providerExecution"), false);
  assert.equal(harness.projections.length, REGENERATED_PHASE_COUNT);
  assert.deepEqual(harness.projections[0], harness.projections[1]);
  assert.equal(harness.sessions[0], undefined);
  assert.deepEqual(harness.sessions[1], {
    startingProviderCallsMade: INITIAL_PROVIDER_CALLS,
    providerCallCap: 3,
    initialMaxTokens: REDUCED_MAX_TOKENS,
  });
  assert.deepEqual(harness.logs.map((event) => {
    return event.decision;
  }), ["ATTEMPTED", "SUCCEEDED"]);
  assert.deepEqual(Object.keys(harness.logs[0]), [
    "event", "decision", "eligibilityReason", "providerCallCap", "providerCallsMade",
  ]);
  const serializedLogs = JSON.stringify(harness.logs);
  for (const forbidden of [
    "successfulRequestTokenBudget", "rateLimitTokenRemaining",
    "rateLimitRequestRemaining", "retryAfterMs", "semanticOutput",
  ]) {
    assert.equal(serializedLogs.includes(forbidden), false);
  }
});

test("bounded retry repairs one non-verbatim facet through the same validation path", async () => {
  const invalidFacet = createSemanticOutput();
  invalidFacet.requirementMatches[0].supportedFacets[0].text = "Vue";
  const harness = createHarness(invalidFacet, {
    matcherResults: [{
      semanticOutput: invalidFacet,
      providerExecution: createRetryableExecution(),
    }, {
      semanticOutput: createSemanticOutput(),
      providerExecution: createRetryableExecution({ providerCallsMade: 3 }),
    }],
  });

  const brief = await harness.builder.build({
    offerAnalysis: createAnalysis(), offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
    candidateDossier: createDossier(),
  });

  assert.equal(brief.requirementMatches[0].supportedFacets[0].text, "React");
  assert.equal(harness.projections.length, REGENERATED_PHASE_COUNT);
  assert.deepEqual(harness.logs.map((event) => {
    return event.eligibilityReason;
  }), ["FACET_NOT_IN_REQUIREMENT", "FACET_NOT_IN_REQUIREMENT"]);
});

test("bounded retry skips every failed proven-headroom gate with one closed reason", async () => {
  const cases = [
    [{ providerCallsMade: 3 }, "PROVIDER_CALL_CAP_REACHED"],
    [{ successfulRequestTokenBudget: undefined }, "REQUEST_TOKEN_BUDGET_UNAVAILABLE"],
    [{ rateLimitTokenRemaining: undefined }, "TOKEN_REMAINING_UNAVAILABLE"],
    [{ rateLimitTokenRemaining: REQUEST_TOKEN_BUDGET - 1 }, "TOKEN_HEADROOM_INSUFFICIENT"],
    [{ rateLimitRequestRemaining: undefined }, "REQUEST_REMAINING_UNAVAILABLE"],
    [{ rateLimitRequestRemaining: 0 }, "REQUEST_HEADROOM_INSUFFICIENT"],
    [{ retryAfterMs: ACTIVE_RETRY_AFTER_MS }, "RETRY_AFTER_ACTIVE"],
  ];
  const fixtures = createTwoRequirementFixtures();
  for (const [overrides, skipReason] of cases) {
    const harness = createHarness(createSemanticOutput(), {
      matcherResults: [{
        semanticOutput: createSemanticOutput(),
        providerExecution: createRetryableExecution(overrides),
      }],
    });
    await assert.rejects(harness.builder.build({
      offerAnalysis: fixtures.analysis, offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
      candidateDossier: createDossier(),
    }), (error) => {
      return error instanceof ApplicationBriefMatcherError
        && error.cause.reason === "INCOMPLETE_REQUIREMENT_COVERAGE";
    });
    assert.equal(harness.projections.length, 1);
    assert.deepEqual(harness.logs, [{
      event: "application_brief_local_regeneration",
      decision: "SKIPPED",
      eligibilityReason: "INCOMPLETE_REQUIREMENT_COVERAGE",
      providerCallCap: 3,
      skipReason,
      providerCallsMade: overrides.providerCallsMade ?? INITIAL_PROVIDER_CALLS,
    }]);
  }
});

test("equal greater and zero-delay headroom permit exactly one regeneration", async () => {
  const fixtures = createTwoRequirementFixtures();
  for (const overrides of [
    {},
    { rateLimitTokenRemaining: GREATER_TOKEN_HEADROOM },
    { retryAfterMs: 0 },
  ]) {
    const harness = createHarness(createSemanticOutput(), {
      matcherResults: [{
        semanticOutput: createSemanticOutput(),
        providerExecution: createRetryableExecution(overrides),
      }, {
        semanticOutput: fixtures.semanticOutput,
        providerExecution: createRetryableExecution({ providerCallsMade: 3 }),
      }],
    });
    await harness.builder.build({
      offerAnalysis: fixtures.analysis, offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
      candidateDossier: createDossier(),
    });
    assert.equal(harness.projections.length, REGENERATED_PHASE_COUNT);
  }
});

test("a second local failure is terminal and never schedules another regeneration", async () => {
  const invalidFacet = createSemanticOutput();
  invalidFacet.requirementMatches[0].supportedFacets[0].text = "Vue";
  const harness = createHarness(invalidFacet, {
    matcherResults: [{
      semanticOutput: invalidFacet,
      providerExecution: createRetryableExecution(),
    }, {
      semanticOutput: invalidFacet,
      providerExecution: createRetryableExecution({ providerCallsMade: 3 }),
    }],
  });
  await assert.rejects(harness.builder.build({
    offerAnalysis: createAnalysis(), offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
    candidateDossier: createDossier(),
  }), (error) => {
    return error instanceof ApplicationBriefMatcherError
      && error.cause.reason === "FACET_NOT_IN_REQUIREMENT";
  });
  assert.equal(harness.projections.length, REGENERATED_PHASE_COUNT);
  assert.equal(harness.logs.at(-1).decision, "FAILED_LOCAL");
});

test("a local regeneration provider rate limit remains terminal", async () => {
  const fixtures = createTwoRequirementFixtures();
  const providerError = new ApplicationBriefMatcherError(
    ApplicationBriefMatcherError.CODE.RATE_LIMITED,
  );
  const harness = createHarness(createSemanticOutput(), {
    matcherResults: [{
      semanticOutput: createSemanticOutput(),
      providerExecution: createRetryableExecution(),
    }, providerError],
  });
  await assert.rejects(harness.builder.build({
    offerAnalysis: fixtures.analysis, offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
    candidateDossier: createDossier(),
  }), (error) => {
    return error === providerError;
  });
  assert.equal(harness.projections.length, REGENERATED_PHASE_COUNT);
  assert.equal(harness.logs.at(-1).decision, "FAILED_PROVIDER");
  assert.equal(harness.logs.at(-1).providerClassification, "APPLICATION_BRIEF_RATE_LIMITED");
});

test("non-whitelisted contextual failures never evaluate regeneration headroom", async () => {
  const deterministic = new ApplicationBriefContextValidationError(
    ApplicationBriefContextValidationError.REASON.EVIDENCE_VALUE_MISMATCH,
  );
  const harness = createHarness(createSemanticOutput(), {
    contextValidator: {
      validate() {
        throw deterministic;
      },
    },
  });
  await assert.rejects(harness.builder.build({
    offerAnalysis: createAnalysis(), offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
    candidateDossier: createDossier(),
  }), (error) => {
    return error === deterministic;
  });
  assert.equal(harness.projections.length, 1);
  assert.deepEqual(harness.logs, []);
});

test("local regeneration logging failure never changes successful recovery", async () => {
  const fixtures = createTwoRequirementFixtures();
  const harness = createHarness(createSemanticOutput(), {
    matcherResults: [{
      semanticOutput: createSemanticOutput(),
      providerExecution: createRetryableExecution(),
    }, {
      semanticOutput: fixtures.semanticOutput,
      providerExecution: createRetryableExecution({ providerCallsMade: 3 }),
    }],
    logger: {
      warn() {
        throw new Error("logger failure");
      },
    },
  });
  const brief = await harness.builder.build({
    offerAnalysis: fixtures.analysis, offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
    candidateDossier: createDossier(),
  });
  assert.equal(brief.requirementMatches.length, REGENERATED_PHASE_COUNT);
});

test("hallucinated offer and evidence refs and invalid facets fail as contextual output", async () => {
  const cases = [];
  const badOffer = createSemanticOutput();
  badOffer.requirementMatches[0].offerRef.index = 1;
  cases.push(badOffer);
  const badEvidence = structuredClone(createSemanticOutput());
  badEvidence.requirementMatches[0].supportedFacets[0].evidenceRefs[0].itemId = "missing";
  badEvidence.emphasis[0].evidenceRefs[0].itemId = "missing";
  badEvidence.supportedClaims[0].evidenceRefs[0].itemId = "missing";
  badEvidence.cautions[0].evidenceRefs[0].itemId = "missing";
  cases.push(badEvidence);
  const badFacet = createSemanticOutput();
  badFacet.requirementMatches[0].supportedFacets[0].text = "Vue";
  cases.push(badFacet);

  for (const semanticOutput of cases) {
    const harness = createHarness(semanticOutput);
    await assert.rejects(harness.builder.build({
      offerAnalysis: createAnalysis(), offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
      candidateDossier: createDossier(),
    }), (error) => {
      assert.equal(error instanceof ApplicationBriefMatcherError, true);
      assert.equal(error.code, ApplicationBriefMatcherError.CODE.INVALID_OUTPUT);
      assert.equal(error.reason, ApplicationBriefMatcherError.REASON.INVALID_CONTEXTUAL_OUTPUT);
      if (semanticOutput === badEvidence) {
        assert.deepEqual(error.cause.safeDetails, {
          evidenceReferenceFailure: "ITEM_NOT_FOUND_FOR_KIND",
          evidenceKind: "EXPERIENCE",
          evidenceFieldClass: "SCALAR",
        });
      }
      return true;
    });
  }
});

test("incomplete coverage remains terminal without matcher regeneration", async () => {
  const semanticOutput = createSemanticOutput();
  semanticOutput.requirementMatches = [];
  const harness = createHarness(semanticOutput);

  await assert.rejects(harness.builder.build({
    offerAnalysis: createAnalysis(), offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
    candidateDossier: createDossier(),
  }), (error) => {
    assert.equal(error instanceof ApplicationBriefMatcherError, true);
    assert.equal(error.reason, ApplicationBriefMatcherError.REASON.INVALID_CONTEXTUAL_OUTPUT);
    assert.equal(
      error.cause?.reason,
      ApplicationBriefContextValidationError.REASON.INCOMPLETE_REQUIREMENT_COVERAGE,
    );
    return true;
  });
  assert.equal(harness.projections.length, 1);
});

test("grounded support without a strategic claim fails as contextual model output", async () => {
  const semanticOutput = createSemanticOutput();
  semanticOutput.supportedClaims = [];
  const snapshot = structuredClone(semanticOutput);
  await assert.rejects(createHarness(semanticOutput).builder.build({
    offerAnalysis: createAnalysis(), offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
    candidateDossier: createDossier(),
  }), (error) => {
    assert.equal(error instanceof ApplicationBriefMatcherError, true);
    assert.equal(error.code, ApplicationBriefMatcherError.CODE.INVALID_OUTPUT);
    assert.equal(error.reason, ApplicationBriefMatcherError.REASON.INVALID_CONTEXTUAL_OUTPUT);
    assert.equal(
      error.cause?.reason,
      ApplicationBriefContextValidationError.REASON
        .MISSING_SUPPORTED_CLAIMS_WITH_POSITIVE_EVIDENCE,
    );
    return true;
  });
  assert.deepEqual(semanticOutput, snapshot);
  assert.deepEqual(semanticOutput.supportedClaims, []);
});

test("authoritative stale input remains a contextual error instead of a model error", async () => {
  const baseAssembler = createHarness(createSemanticOutput()).assembler;
  const staleAssembler = {
    assemble(inputs) {
      const assembled = baseAssembler.assemble(inputs);
      assembled.inputIdentity.offer.offerId += 1;
      return assembled;
    },
  };
  const harness = createHarness(createSemanticOutput(), { assembler: staleAssembler });
  await assert.rejects(harness.builder.build({
    offerAnalysis: createAnalysis(), offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
    candidateDossier: createDossier(),
  }), (error) => {
    assert.equal(error instanceof ApplicationBriefContextValidationError, true);
    assert.equal(error.reason, ApplicationBriefContextValidationError.REASON.STALE_INPUT);
    return true;
  });
});

test("final structural errors remain visible as deterministic invariant failures", async () => {
  const harness = createHarness(createSemanticOutput(), {
    assembler: {
      assemble() {
        return {};
      },
    },
  });
  await assert.rejects(harness.builder.build({
    offerAnalysis: createAnalysis(), offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
    candidateDossier: createDossier(),
  }), ApplicationBriefValidationError);
});

test("malformed authoritative offer identity is never blamed on model output", async () => {
  const malformedIdentity = { ...OFFER_IDENTITY, offerId: "invalid" };
  await assert.rejects(createHarness(createSemanticOutput()).builder.build({
    offerAnalysis: createAnalysis(), offerSnapshot: {}, offerIdentity: malformedIdentity,
    candidateDossier: createDossier(),
  }), (error) => {
    assert.equal(error instanceof ApplicationBriefValidationError, true);
    assert.equal(error instanceof ApplicationBriefMatcherError, false);
    return true;
  });
});

test("invalid authoritative candidate remains a candidate input validation error", async () => {
  const invalidValue = createDossier().toJson();
  invalidValue.experiences[0].role = "";
  const invalidDossier = new CandidateDossier(invalidValue);
  await assert.rejects(createHarness(createSemanticOutput()).builder.build({
    offerAnalysis: createAnalysis(), offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
    candidateDossier: invalidDossier,
  }), (error) => {
    assert.equal(error instanceof CandidateDossierValidationError, true);
    assert.equal(error instanceof ApplicationBriefMatcherError, false);
    return true;
  });
});

test("unexpected assembler errors remain unchanged", async () => {
  const internal = new Error("internal failure");
  const harness = createHarness(createSemanticOutput(), {
    assembler: {
      assemble() {
        throw internal;
      },
    },
  });
  await assert.rejects(harness.builder.build({
    offerAnalysis: createAnalysis(), offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
    candidateDossier: createDossier(),
  }), (error) => {
    assert.equal(error, internal);
    return true;
  });
});

test("post-assembly evidence invariant errors remain contextual instead of model errors", async () => {
  const reasons = [
    ApplicationBriefContextValidationError.REASON.INVALID_EVIDENCE_REFERENCE,
    ApplicationBriefContextValidationError.REASON.EVIDENCE_VALUE_MISMATCH,
  ];
  for (const reason of reasons) {
    const original = new ApplicationBriefContextValidationError(reason);
    const harness = createHarness(createSemanticOutput(), {
      contextValidator: {
        validate() {
          throw original;
        },
      },
    });
    await assert.rejects(harness.builder.build({
      offerAnalysis: createAnalysis(), offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
      candidateDossier: createDossier(),
    }), (error) => {
      assert.equal(error, original);
      return true;
    });
  }
});

test("empty candidate produces valid not-evidenced matches without facts", async () => {
  const semanticOutput = {
    requirementMatches: [{
      offerRef: { kind: "REQUIREMENT", index: 0 }, state: "NOT_EVIDENCED",
      supportedFacets: [], notEvidencedFacets: [{ text: "React" }],
    }],
    emphasis: [], supportedClaims: [], cautions: [],
  };
  const brief = await createHarness(semanticOutput).builder.build({
    offerAnalysis: createAnalysis(), offerSnapshot: {}, offerIdentity: OFFER_IDENTITY,
    candidateDossier: CandidateDossier.empty(),
  });
  assert.equal(brief instanceof ApplicationBrief, true);
  assert.deepEqual(brief.evidenceFacts, []);
});

test("empty requirements produce a valid empty semantic brief", async () => {
  const semanticOutput = {
    requirementMatches: [], emphasis: [], supportedClaims: [], cautions: [],
  };
  const brief = await createHarness(semanticOutput).builder.build({
    offerAnalysis: createAnalysis({ requirements: [] }),
    offerSnapshot: {},
    offerIdentity: OFFER_IDENTITY,
    candidateDossier: createDossier(),
  });
  assert.equal(brief instanceof ApplicationBrief, true);
  assert.deepEqual(brief.requirementMatches, []);
  assert.deepEqual(brief.evidenceFacts, []);
});
