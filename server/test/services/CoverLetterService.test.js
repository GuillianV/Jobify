import test from "node:test";
import assert from "node:assert/strict";
import { CoverLetterServiceConstants } from "../../src/constants/CoverLetterServiceConstants.js";
import { ApplicationBriefContextValidationError } from "../../src/services/ApplicationBriefContextValidationError.js";
import { ApplicationBriefIntegritySigner } from "../../src/services/ApplicationBriefIntegritySigner.js";
import { ApplicationBriefService } from "../../src/services/ApplicationBriefService.js";
import { CandidateDossierServiceError } from "../../src/services/CandidateDossierServiceError.js";
import { CoverLetterGeneratorError } from "../../src/services/CoverLetterGeneratorError.js";
import { CoverLetterService } from "../../src/services/CoverLetterService.js";
import { CoverLetterServiceError } from "../../src/services/CoverLetterServiceError.js";

const OFFER_ID = 42;
const OTHER_OFFER_ID = 84;
const SIGNING_SECRET_BYTES = 32;
const SHA_256_HEX_LENGTH = 64;
const ALTERNATE_SECRET_FILL = 2;
const EXPLICIT_GENERATION_COUNT = 2;

/**
 * Create one deterministic process-local signer.
 * @param {number} [fill] - Secret fill byte.
 * @returns {ApplicationBriefIntegritySigner} Deterministic signer.
 */
function createSigner(fill = 1) {
  return new ApplicationBriefIntegritySigner(Buffer.alloc(SIGNING_SECRET_BYTES, fill));
}

/**
 * Build one representative signed brief transport value.
 * @param {number} [offerId] - Embedded offer identifier.
 * @returns {object} Minimal transport brief used by service fakes.
 */
function createBrief(offerId = OFFER_ID) {
  return {
    schemaVersion: "application-brief-schema-v1",
    inputIdentity: { offer: { offerId } },
    evidenceFacts: [{ ref: { kind: "SKILL" }, value: "React" }],
    supportedClaims: [{ claimType: "SKILL_DECLARATION" }],
    emphasis: [{ priority: "PRIMARY" }],
    cautions: [{ kind: "DURATION_UNSUPPORTED" }],
  };
}

/**
 * Build a complete observable service harness.
 * @param {object} [behavior] - Optional collaborator behavior.
 * @returns {object} Harness state and collaborators.
 */
function createHarness(behavior = {}) {
  const calls = [];
  const signer = behavior.signer ?? createSigner();
  const brief = behavior.brief ?? createBrief();
  const generationToken = behavior.generationToken ?? signer.sign(brief);
  const analysis = { requirements: [] };
  const offerSnapshot = { title: "Backend Engineer", company: null };
  const identity = {
    offerId: OFFER_ID,
    cacheKey: "a".repeat(SHA_256_HEX_LENGTH),
    schemaVersion: "offer-analysis-schema-v1",
    policyVersion: "offer-analyzer-policy-v1",
  };
  const dossier = { schemaVersion: "candidate-dossier-schema-v1" };
  const validatedBrief = { kind: "validated-application-brief" };
  const generationProjection = { offer: {}, claims: [{}], boundaries: {} };
  const coverLetter = { kind: "cover-letter" };
  const observedSigner = {
    verify(value, token) {
      calls.push({ stage: "verify", value, token });
      if (behavior.verifyError) {
        throw behavior.verifyError;
      }
      if (behavior.verifyResult !== undefined) {
        return behavior.verifyResult;
      }
      return signer.verify(value, token);
    },
  };
  const offerAnalysisService = {
    async analyze(offerId) {
      calls.push({ stage: "analysis", offerId });
      if (behavior.analysisError) {
        throw behavior.analysisError;
      }
      return { analysis, offerSnapshot, identity };
    },
  };
  const candidateDossierService = {
    get() {
      calls.push({ stage: "candidate" });
      if (behavior.candidateError) {
        throw behavior.candidateError;
      }
      return { dossier, updatedAt: null };
    },
  };
  const applicationBriefContextValidator = {
    validate(value, context) {
      calls.push({ stage: "context", value, context });
      if (behavior.contextError) {
        throw behavior.contextError;
      }
      return validatedBrief;
    },
  };
  const coverLetterInputProjector = {
    project(inputs) {
      calls.push({ stage: "project", inputs });
      if (behavior.projectorError) {
        throw behavior.projectorError;
      }
      return generationProjection;
    },
  };
  const coverLetterGenerator = {
    async generate(input) {
      calls.push({ stage: "generate", input });
      if (behavior.generatorError) {
        throw behavior.generatorError;
      }
      return coverLetter;
    },
  };
  const service = new CoverLetterService({
    applicationBriefIntegritySigner: observedSigner,
    offerAnalysisService,
    candidateDossierService,
    applicationBriefContextValidator,
    coverLetterInputProjector,
    coverLetterGenerator,
  });
  return {
    service, calls, signer, brief, generationToken, analysis, offerSnapshot, identity,
    dossier, validatedBrief, generationProjection, coverLetter,
  };
}

/**
 * Assert one rejected service reason.
 * @param {Promise<unknown>} promise - Rejected operation.
 * @param {string} code - Expected service code.
 * @returns {Promise<void>} Resolves after the assertion.
 */
async function assertServiceError(promise, code) {
  await assert.rejects(promise, (error) => {
    return error instanceof CoverLetterServiceError && error.code === code;
  });
}

/**
 * Create a request whose JSON representation has an exact length.
 * @param {number} length - Required serialized character length.
 * @returns {object} Exact-size request.
 */
function createSizedRequest(length) {
  const request = {
    brief: { inputIdentity: { offer: { offerId: OFFER_ID } }, padding: "" },
    generationToken: "token",
  };
  const baseLength = JSON.stringify(request).length;
  request.brief.padding = "x".repeat(length - baseLength);
  assert.equal(JSON.stringify(request).length, length);
  return request;
}

test("happy path enforces trust order and passes only validated authoritative values", async () => {
  const harness = createHarness();
  const result = await harness.service.generateForOffer(OFFER_ID, {
    brief: harness.brief,
    generationToken: harness.generationToken,
  });

  assert.equal(result, harness.coverLetter);
  assert.deepEqual(harness.calls.map((call) => {
    return call.stage;
  }), ["verify", "analysis", "candidate", "context", "project", "generate"]);
  const context = harness.calls.find((call) => {
    return call.stage === "context";
  }).context;
  assert.deepEqual(context, {
    offerAnalysis: harness.analysis,
    offerIdentity: {
      offerId: OFFER_ID,
      analysisFingerprint: harness.identity.cacheKey,
      analysisSchemaVersion: harness.identity.schemaVersion,
      analyzerPolicyVersion: harness.identity.policyVersion,
    },
    candidateDossier: harness.dossier,
  });
  const projectorInputs = harness.calls.find((call) => {
    return call.stage === "project";
  }).inputs;
  assert.deepEqual(projectorInputs, {
    applicationBrief: harness.validatedBrief,
    offerAnalysis: harness.analysis,
    offerSnapshot: harness.offerSnapshot,
  });
  assert.equal(harness.calls.at(-1).input, harness.generationProjection);
});

test("invalid offer ids and request roots stop every dependency", async () => {
  const invalidRequests = [
    null, undefined, [], "request", {}, { brief: {} }, { generationToken: "token" },
    { brief: {}, generationToken: "" },
    { brief: {}, generationToken: "token", extra: true },
  ];
  for (const request of invalidRequests) {
    const harness = createHarness();
    await assertServiceError(
      harness.service.generateForOffer(OFFER_ID, request),
      CoverLetterServiceError.CODE.INVALID_REQUEST,
    );
    assert.deepEqual(harness.calls, []);
  }
  for (const offerId of [0, -1, "42", Number.MAX_SAFE_INTEGER + 1]) {
    const harness = createHarness();
    await assertServiceError(
      harness.service.generateForOffer(offerId, {
        brief: harness.brief, generationToken: harness.generationToken,
      }),
      CoverLetterServiceError.CODE.INVALID_REQUEST,
    );
    assert.deepEqual(harness.calls, []);
  }
});

test("request size accepts 200000 and rejects 200001 before signer verification", async () => {
  const exact = createHarness({ verifyResult: false });
  await assertServiceError(
    exact.service.generateForOffer(
      OFFER_ID,
      createSizedRequest(CoverLetterServiceConstants.MAX_REQUEST_CHARACTERS),
    ),
    CoverLetterServiceError.CODE.REFRESH_REQUIRED,
  );
  assert.deepEqual(exact.calls.map((call) => {
    return call.stage;
  }), ["verify"]);

  const excess = createHarness({ verifyResult: true });
  await assertServiceError(
    excess.service.generateForOffer(
      OFFER_ID,
      createSizedRequest(CoverLetterServiceConstants.MAX_REQUEST_CHARACTERS + 1),
    ),
    CoverLetterServiceError.CODE.REQUEST_TOO_LARGE,
  );
  assert.deepEqual(excess.calls, []);
});

test("unserializable requests fail closed before signer verification", async () => {
  const harness = createHarness();
  const request = { brief: {}, generationToken: "token" };
  request.brief.cycle = request;
  await assertServiceError(
    harness.service.generateForOffer(OFFER_ID, request),
    CoverLetterServiceError.CODE.INVALID_REQUEST,
  );
  assert.deepEqual(harness.calls, []);
});

test("invalid HMAC and signer canonicalization failures require refresh before reload", async () => {
  for (const behavior of [
    { verifyResult: false },
    { verifyError: new TypeError("private canonical failure") },
  ]) {
    const harness = createHarness(behavior);
    await assertServiceError(
      harness.service.generateForOffer(OFFER_ID, {
        brief: harness.brief, generationToken: "v1.invalid",
      }),
      CoverLetterServiceError.CODE.REFRESH_REQUIRED,
    );
    assert.deepEqual(harness.calls.map((call) => {
      return call.stage;
    }), ["verify"]);
  }
});

test("authentic malformed signed offer identities fail as internal invariants before reload", async () => {
  const malformedBriefs = [
    (() => {
      const brief = createBrief();
      delete brief.inputIdentity;
      return brief;
    })(),
    { ...createBrief(), inputIdentity: {} },
    { ...createBrief(), inputIdentity: { offer: { offerId: "123" } } },
    { ...createBrief(), inputIdentity: { offer: { offerId: null } } },
    { ...createBrief(), inputIdentity: { offer: { offerId: 0 } } },
  ];
  for (const brief of malformedBriefs) {
    const harness = createHarness({ brief });
    await assertServiceError(
      harness.service.generateForOffer(OFFER_ID, {
        brief, generationToken: harness.generationToken,
      }),
      CoverLetterServiceError.CODE.INTERNAL_INVARIANT,
    );
    assert.deepEqual(harness.calls.map((call) => {
      return call.stage;
    }), ["verify"]);
  }
});

test("authentic brief for another route requires refresh before authoritative reload", async () => {
  const brief = createBrief(OTHER_OFFER_ID);
  const harness = createHarness({ brief });
  await assertServiceError(
    harness.service.generateForOffer(OFFER_ID, {
      brief, generationToken: harness.generationToken,
    }),
    CoverLetterServiceError.CODE.REFRESH_REQUIRED,
  );
  assert.deepEqual(harness.calls.map((call) => {
    return call.stage;
  }), ["verify"]);
});

test("representative brief tampering and a token from another brief stop before reload", async () => {
  const mutations = [
    (brief) => {
      brief.evidenceFacts[0].value = "Kubernetes";
    },
    (brief) => {
      brief.cautions.pop();
    },
    (brief) => {
      brief.supportedClaims[0].claimType = "EXPERIENCE_FACT";
    },
    (brief) => {
      brief.emphasis[0].priority = "SECONDARY";
    },
  ];
  for (const mutate of mutations) {
    const harness = createHarness();
    const tampered = structuredClone(harness.brief);
    mutate(tampered);
    await assertServiceError(
      harness.service.generateForOffer(OFFER_ID, {
        brief: tampered, generationToken: harness.generationToken,
      }),
      CoverLetterServiceError.CODE.REFRESH_REQUIRED,
    );
    assert.deepEqual(harness.calls.map((call) => {
      return call.stage;
    }), ["verify"]);
  }

  const harness = createHarness();
  const otherToken = harness.signer.sign(createBrief(OTHER_OFFER_ID));
  await assertServiceError(
    harness.service.generateForOffer(OFFER_ID, {
      brief: harness.brief, generationToken: otherToken,
    }),
    CoverLetterServiceError.CODE.REFRESH_REQUIRED,
  );
});

test("a signer from another process rejects the previous process token", async () => {
  const brief = createBrief();
  const previousSigner = createSigner();
  const harness = createHarness({
    signer: createSigner(ALTERNATE_SECRET_FILL),
    brief,
    generationToken: previousSigner.sign(brief),
  });
  await assertServiceError(
    harness.service.generateForOffer(OFFER_ID, {
      brief, generationToken: harness.generationToken,
    }),
    CoverLetterServiceError.CODE.REFRESH_REQUIRED,
  );
  assert.deepEqual(harness.calls.map((call) => {
    return call.stage;
  }), ["verify"]);
});

test("stale context becomes refresh required before projection and generation", async () => {
  const contextError = new ApplicationBriefContextValidationError(
    ApplicationBriefContextValidationError.REASON.STALE_INPUT,
  );
  const harness = createHarness({ contextError });
  await assertServiceError(
    harness.service.generateForOffer(OFFER_ID, {
      brief: harness.brief, generationToken: harness.generationToken,
    }),
    CoverLetterServiceError.CODE.REFRESH_REQUIRED,
  );
  assert.deepEqual(harness.calls.map((call) => {
    return call.stage;
  }), ["verify", "analysis", "candidate", "context"]);
});

test("other context and projector failures become internal invariants", async () => {
  const failures = [
    { contextError: new TypeError("invalid signed structure"), finalStage: "context" },
    { projectorError: new TypeError("projection invariant"), finalStage: "project" },
  ];
  for (const behavior of failures) {
    const harness = createHarness(behavior);
    await assertServiceError(
      harness.service.generateForOffer(OFFER_ID, {
        brief: harness.brief, generationToken: harness.generationToken,
      }),
      CoverLetterServiceError.CODE.INTERNAL_INVARIANT,
    );
    assert.equal(harness.calls.at(-1).stage, behavior.finalStage);
    assert.equal(harness.calls.some((call) => {
      return call.stage === "generate";
    }), false);
  }
});

test("OfferAnalysis and closed generator failures retain their exact causal identity", async () => {
  const analysisError = new Error("authoritative analysis failure");
  const analysisHarness = createHarness({ analysisError });
  await assert.rejects(
    analysisHarness.service.generateForOffer(OFFER_ID, {
      brief: analysisHarness.brief,
      generationToken: analysisHarness.generationToken,
    }),
    (error) => {
      return error === analysisError;
    },
  );

  const generatorError = new CoverLetterGeneratorError(
    CoverLetterGeneratorError.CODE.TIMEOUT,
  );
  const generatorHarness = createHarness({ generatorError });
  await assert.rejects(
    generatorHarness.service.generateForOffer(OFFER_ID, {
      brief: generatorHarness.brief,
      generationToken: generatorHarness.generationToken,
    }),
    (error) => {
      return error === generatorError;
    },
  );
});

test("Candidate service failures become sanitized internal invariants", async () => {
  const candidateError = new CandidateDossierServiceError(
    CandidateDossierServiceError.CODE.PERSISTENCE_ERROR,
  );
  const harness = createHarness({ candidateError });
  await assertServiceError(
    harness.service.generateForOffer(OFFER_ID, {
      brief: harness.brief, generationToken: harness.generationToken,
    }),
    CoverLetterServiceError.CODE.INTERNAL_INVARIANT,
  );
  assert.deepEqual(harness.calls.map((call) => {
    return call.stage;
  }), ["verify", "analysis", "candidate"]);
});

test("one authentic token can be reused for two explicit generations", async () => {
  const harness = createHarness();
  const request = { brief: harness.brief, generationToken: harness.generationToken };
  assert.equal(await harness.service.generateForOffer(OFFER_ID, request), harness.coverLetter);
  assert.equal(await harness.service.generateForOffer(OFFER_ID, request), harness.coverLetter);
  assert.equal(harness.calls.filter((call) => {
    return call.stage === "verify";
  }).length, EXPLICIT_GENERATION_COUNT);
  assert.equal(harness.calls.filter((call) => {
    return call.stage === "generate";
  }).length, EXPLICIT_GENERATION_COUNT);
});

test("ApplicationBrief issuance and CoverLetter verification share one signer", async () => {
  const signer = createSigner();
  const brief = createBrief();
  const applicationBriefService = new ApplicationBriefService({
    offerAnalysisService: {
      async analyze() {
        return {
          analysis: {}, offerSnapshot: {},
          identity: {
            offerId: OFFER_ID,
            cacheKey: "a".repeat(SHA_256_HEX_LENGTH),
            schemaVersion: "offer-analysis-schema-v1",
            policyVersion: "offer-analyzer-policy-v1",
          },
        };
      },
    },
    candidateDossierService: {
      get() {
        return { dossier: {} };
      },
    },
    applicationBriefBuilder: {
      async build() {
        return {
          toJson() {
            return structuredClone(brief);
          },
        };
      },
    },
    applicationBriefIntegritySigner: signer,
  });
  const issued = await applicationBriefService.generateForOffer(OFFER_ID);
  const harness = createHarness({
    signer,
    brief: issued.brief,
    generationToken: issued.generationToken,
  });

  assert.equal(
    await harness.service.generateForOffer(OFFER_ID, issued),
    harness.coverLetter,
  );
  assert.equal(signer.verify(issued.brief, issued.generationToken), true);
});

test("service error taxonomy is exact and rejects unknown codes", () => {
  assert.deepEqual(CoverLetterServiceError.CODE, {
    INVALID_REQUEST: "INVALID_REQUEST",
    REQUEST_TOO_LARGE: "REQUEST_TOO_LARGE",
    REFRESH_REQUIRED: "REFRESH_REQUIRED",
    INTERNAL_INVARIANT: "INTERNAL_INVARIANT",
  });
  assert.throws(() => {
    return new CoverLetterServiceError("UNKNOWN");
  }, TypeError);
});
