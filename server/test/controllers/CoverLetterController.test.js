import test from "node:test";
import assert from "node:assert/strict";
import { HttpStatus } from "../../src/constants/HttpStatus.js";
import { CoverLetterLimits } from "../../src/constants/CoverLetterLimits.js";
import { OfferPreparationConstants } from "../../src/constants/OfferPreparationConstants.js";
import { CoverLetterController } from "../../src/controllers/CoverLetterController.js";
import { OfferIdParser } from "../../src/controllers/OfferIdParser.js";
import { CoverLetter } from "../../src/models/CoverLetter.js";
import { ApplicationBriefContextValidationError } from "../../src/services/ApplicationBriefContextValidationError.js";
import { ApplicationBriefIntegritySigner } from "../../src/services/ApplicationBriefIntegritySigner.js";
import { CoverLetterGeneratorError } from "../../src/services/CoverLetterGeneratorError.js";
import { CoverLetterService } from "../../src/services/CoverLetterService.js";
import { CoverLetterServiceError } from "../../src/services/CoverLetterServiceError.js";
import { OfferAnalysisServiceError } from "../../src/services/OfferAnalysisServiceError.js";
import { OfferAnalyzerError } from "../../src/services/OfferAnalyzerError.js";
import { OfferPreparationError } from "../../src/services/OfferPreparationError.js";

const OFFER_ID = 42;

/**
 * Build one controller harness with captured service and view calls.
 * @param {object} behavior - Fake service behavior.
 * @returns {object} Controller, domain result, and captured state.
 */
function createHarness(behavior = {}) {
  const state = { calls: [], success: null, error: null };
  const coverLetter = new CoverLetter({
    letter: "L".repeat(CoverLetterLimits.MINIMUM_LETTER_LENGTH),
    usedClaimIndexes: [0],
  });
  const service = {
    async generateForOffer(offerId, request) {
      state.calls.push({ offerId, request });
      if (behavior.error) {
        throw behavior.error;
      }
      return coverLetter;
    },
  };
  const view = {
    renderSuccess(response, payload) {
      state.success = payload;
    },
    renderError(response, statusCode, message, metadata) {
      state.error = { statusCode, message, metadata };
    },
  };
  return {
    controller: new CoverLetterController(service, view, new OfferIdParser()),
    coverLetter,
    state,
  };
}

/**
 * Build one controller using the real strict CoverLetter trust service.
 * @param {object} [behavior] - Authoritative stage behavior.
 * @returns {object} Controller, signer, brief, and captured state.
 */
function createTrustBoundaryHarness(behavior = {}) {
  const state = { stages: [], success: null, error: null };
  const signer = new ApplicationBriefIntegritySigner(
    Buffer.alloc(CoverLetterLimits.INTEGRITY_SECRET_BYTES, 1),
  );
  const brief = { inputIdentity: { offer: { offerId: OFFER_ID } } };
  const service = new CoverLetterService({
    applicationBriefIntegritySigner: {
      verify(value, token) {
        state.stages.push("verify");
        return signer.verify(value, token);
      },
    },
    offerAnalysisService: {
      async analyze() {
        state.stages.push("analysis");
        return {
          analysis: {},
          offerSnapshot: {},
          identity: {
            offerId: OFFER_ID,
            cacheKey: "a",
            schemaVersion: "schema",
            policyVersion: "policy",
          },
        };
      },
    },
    candidateDossierService: {
      get() {
        state.stages.push("candidate");
        return { dossier: {} };
      },
    },
    applicationBriefContextValidator: {
      validate() {
        state.stages.push("context");
        if (behavior.contextError) {
          throw behavior.contextError;
        }
        return {};
      },
    },
    coverLetterInputProjector: {
      project() {
        state.stages.push("project");
        return {};
      },
    },
    coverLetterGenerator: {
      async generate() {
        state.stages.push("generate");
        return new CoverLetter({
          letter: "L".repeat(CoverLetterLimits.MINIMUM_LETTER_LENGTH),
          usedClaimIndexes: [0],
        });
      },
    },
  });
  const view = {
    renderSuccess(response, payload) {
      state.success = payload;
    },
    renderError(response, statusCode, message, metadata) {
      state.error = { statusCode, message, metadata };
    },
  };
  return {
    controller: new CoverLetterController(service, view, new OfferIdParser()),
    signer,
    brief,
    state,
  };
}

test("controller passes the exact raw body and returns only CoverLetter JSON", async () => {
  const harness = createHarness();
  const body = { brief: {}, generationToken: "token", unexpected: true };
  await harness.controller.generateForOffer({ params: { id: String(OFFER_ID) }, body }, {});

  assert.deepEqual(harness.state.calls, [{ offerId: OFFER_ID, request: body }]);
  assert.equal(harness.state.calls[0].request, body);
  assert.deepEqual(harness.state.success, { coverLetter: harness.coverLetter.toJson() });
  assert.deepEqual(Object.keys(harness.state.success), ["coverLetter"]);
});

test("absent bodies reach the service unchanged", async () => {
  const expected = new CoverLetterServiceError(CoverLetterServiceError.CODE.INVALID_REQUEST);
  const harness = createHarness({ error: expected });
  await harness.controller.generateForOffer({ params: { id: String(OFFER_ID) } }, {});

  assert.deepEqual(harness.state.calls, [{ offerId: OFFER_ID, request: undefined }]);
  assert.deepEqual(harness.state.error, {
    statusCode: HttpStatus.BAD_REQUEST,
    message: "Invalid cover letter request",
    metadata: { code: "INVALID_COVER_LETTER_REQUEST" },
  });
});

test("controller rejects noncanonical offer ids before service delegation", async () => {
  for (const rawId of ["0", "01", "-1", "1.5", "1e2", "9007199254740992", "private"]) {
    const harness = createHarness();
    await harness.controller.generateForOffer({ params: { id: rawId }, body: {} }, {});
    assert.deepEqual(harness.state.calls, []);
    assert.deepEqual(harness.state.error, {
      statusCode: HttpStatus.BAD_REQUEST,
      message: "Invalid offer id",
      metadata: { code: "INVALID_OFFER_ID" },
    });
  }
});

test("controller maps every CoverLetter trust service failure safely", async () => {
  const cases = [
    [CoverLetterServiceError.CODE.INVALID_REQUEST, HttpStatus.BAD_REQUEST,
      "Invalid cover letter request", "INVALID_COVER_LETTER_REQUEST"],
    [CoverLetterServiceError.CODE.REQUEST_TOO_LARGE, HttpStatus.CONTENT_TOO_LARGE,
      "Cover letter request is too large", "COVER_LETTER_REQUEST_TOO_LARGE"],
    [CoverLetterServiceError.CODE.REFRESH_REQUIRED, HttpStatus.CONFLICT,
      "Application brief must be regenerated", "APPLICATION_BRIEF_REFRESH_REQUIRED"],
    [CoverLetterServiceError.CODE.INTERNAL_INVARIANT, HttpStatus.INTERNAL_SERVER_ERROR,
      "Internal server error", "INTERNAL_SERVER_ERROR"],
  ];
  for (const [code, statusCode, message, publicCode] of cases) {
    const error = new CoverLetterServiceError(code, new Error("private trust detail"));
    const harness = createHarness({ error });
    await harness.controller.generateForOffer({
      params: { id: String(OFFER_ID) }, body: {},
    }, {});
    assert.deepEqual(harness.state.error, {
      statusCode, message, metadata: { code: publicCode },
    });
    assert.equal(JSON.stringify(harness.state.error).includes("private"), false);
  }
});

test("controller preserves the OfferAnalysis HTTP error matrix", async () => {
  const cases = [
    [new OfferPreparationError("private", HttpStatus.NOT_FOUND), HttpStatus.NOT_FOUND,
      "Offer not found", "OFFER_NOT_FOUND"],
    [new OfferAnalysisServiceError(OfferAnalysisServiceError.CODE.OFFER_NOT_READY, {
      prepareStatus: OfferPreparationConstants.STATUS.NEEDS_USER_TEXT,
    }), HttpStatus.CONFLICT, "Offer is not ready", "OFFER_NOT_READY"],
    [new OfferAnalyzerError(OfferAnalyzerError.CODE.ANALYZER_INPUT_TOO_LARGE),
      HttpStatus.UNPROCESSABLE_ENTITY, "Offer content is too large to analyze",
      OfferAnalyzerError.CODE.ANALYZER_INPUT_TOO_LARGE],
    [new OfferAnalyzerError(OfferAnalyzerError.CODE.ANALYZER_UNAVAILABLE),
      HttpStatus.SERVICE_UNAVAILABLE, "Offer analysis service is unavailable",
      OfferAnalyzerError.CODE.ANALYZER_UNAVAILABLE],
    [new OfferAnalyzerError(OfferAnalyzerError.CODE.ANALYZER_TIMEOUT),
      HttpStatus.SERVICE_UNAVAILABLE, "Offer analysis service timed out",
      OfferAnalyzerError.CODE.ANALYZER_TIMEOUT],
    [new OfferAnalyzerError(OfferAnalyzerError.CODE.ANALYZER_RATE_LIMITED),
      HttpStatus.SERVICE_UNAVAILABLE, "Offer analysis service is temporarily unavailable",
      OfferAnalyzerError.CODE.ANALYZER_RATE_LIMITED],
    [new OfferAnalyzerError(OfferAnalyzerError.CODE.ANALYZER_PROVIDER_TOKEN_BUDGET),
      HttpStatus.BAD_GATEWAY, "Offer analysis provider rejected the token budget",
      OfferAnalyzerError.CODE.ANALYZER_PROVIDER_TOKEN_BUDGET],
    [new OfferAnalyzerError(OfferAnalyzerError.CODE.ANALYZER_PROVIDER_ERROR),
      HttpStatus.BAD_GATEWAY, "Offer analysis provider failed",
      OfferAnalyzerError.CODE.ANALYZER_PROVIDER_ERROR],
    [new OfferAnalyzerError(OfferAnalyzerError.CODE.ANALYZER_INVALID_OUTPUT),
      HttpStatus.BAD_GATEWAY, "Offer analysis provider returned an invalid response",
      OfferAnalyzerError.CODE.ANALYZER_INVALID_OUTPUT],
  ];
  for (const [error, statusCode, message, code] of cases) {
    const harness = createHarness({ error });
    await harness.controller.generateForOffer({
      params: { id: String(OFFER_ID) }, body: {},
    }, {});
    assert.equal(harness.state.error.statusCode, statusCode);
    assert.equal(harness.state.error.message, message);
    assert.equal(harness.state.error.metadata.code, code);
    assert.equal(JSON.stringify(harness.state.error).includes("private"), false);
  }
});

test("controller maps every CoverLetter generator failure to fixed 422 503 or 502 responses", async () => {
  const code = CoverLetterGeneratorError.CODE;
  const cases = [
    [code.INPUT_TOO_LARGE, HttpStatus.UNPROCESSABLE_ENTITY,
      "Cover letter generation input is too large"],
    [code.INSUFFICIENT_SUPPORTED_CLAIMS, HttpStatus.UNPROCESSABLE_ENTITY,
      "Cover letter requires supported claims"],
    [code.UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE, "Cover letter service is unavailable"],
    [code.TIMEOUT, HttpStatus.SERVICE_UNAVAILABLE, "Cover letter service timed out"],
    [code.RATE_LIMITED, HttpStatus.SERVICE_UNAVAILABLE,
      "Cover letter service is temporarily unavailable"],
    [code.PROVIDER_TOKEN_BUDGET, HttpStatus.BAD_GATEWAY,
      "Cover letter provider rejected the token budget"],
    [code.PROVIDER_ERROR, HttpStatus.BAD_GATEWAY, "Cover letter provider failed"],
    [code.INVALID_OUTPUT, HttpStatus.BAD_GATEWAY,
      "Cover letter provider returned an invalid response"],
  ];
  for (const [errorCode, statusCode, message] of cases) {
    const error = new CoverLetterGeneratorError(errorCode, new Error("private provider detail"));
    const harness = createHarness({ error });
    await harness.controller.generateForOffer({
      params: { id: String(OFFER_ID) }, body: {},
    }, {});
    assert.deepEqual(harness.state.error, {
      statusCode, message, metadata: { code: errorCode },
    });
    assert.equal(JSON.stringify(harness.state.error).includes("private"), false);
  }
});

test("unexpected and persistence failures expose only the generic internal contract", async () => {
  const failures = [
    new Error("secret provider detail"),
    new OfferAnalysisServiceError(OfferAnalysisServiceError.CODE.CACHE_PERSISTENCE_ERROR),
  ];
  for (const error of failures) {
    const harness = createHarness({ error });
    await harness.controller.generateForOffer({
      params: { id: String(OFFER_ID) }, body: {},
    }, {});
    assert.deepEqual(harness.state.error, {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal server error",
      metadata: { code: "INTERNAL_SERVER_ERROR" },
    });
    assert.equal(JSON.stringify(harness.state.error).includes("secret"), false);
  }
});

test("real trust service rejects unknown HTTP root keys without controller cleanup", async () => {
  const harness = createTrustBoundaryHarness();
  const body = {
    brief: harness.brief,
    generationToken: harness.signer.sign(harness.brief),
    unexpected: true,
  };
  await harness.controller.generateForOffer({ params: { id: String(OFFER_ID) }, body }, {});

  assert.deepEqual(harness.state.stages, []);
  assert.deepEqual(harness.state.error, {
    statusCode: HttpStatus.BAD_REQUEST,
    message: "Invalid cover letter request",
    metadata: { code: "INVALID_COVER_LETTER_REQUEST" },
  });
});

test("invalid token modified brief and wrong route share the refresh-required HTTP contract", async () => {
  const cases = [
    (harness) => {
      return { routeId: OFFER_ID, brief: harness.brief, generationToken: "v1.invalid" };
    },
    (harness) => {
      const generationToken = harness.signer.sign(harness.brief);
      return {
        routeId: OFFER_ID,
        brief: { ...harness.brief, tampered: true },
        generationToken,
      };
    },
    (harness) => {
      return {
        routeId: OFFER_ID + 1,
        brief: harness.brief,
        generationToken: harness.signer.sign(harness.brief),
      };
    },
  ];
  for (const buildRequest of cases) {
    const harness = createTrustBoundaryHarness();
    const request = buildRequest(harness);
    await harness.controller.generateForOffer({
      params: { id: String(request.routeId) },
      body: { brief: request.brief, generationToken: request.generationToken },
    }, {});
    assert.deepEqual(harness.state.stages, ["verify"]);
    assert.deepEqual(harness.state.error, {
      statusCode: HttpStatus.CONFLICT,
      message: "Application brief must be regenerated",
      metadata: { code: "APPLICATION_BRIEF_REFRESH_REQUIRED" },
    });
  }
});

test("stale authoritative context uses the unified refresh-required HTTP contract", async () => {
  const contextError = new ApplicationBriefContextValidationError(
    ApplicationBriefContextValidationError.REASON.STALE_INPUT,
  );
  const harness = createTrustBoundaryHarness({ contextError });
  const body = {
    brief: harness.brief,
    generationToken: harness.signer.sign(harness.brief),
  };
  await harness.controller.generateForOffer({ params: { id: String(OFFER_ID) }, body }, {});

  assert.deepEqual(harness.state.stages, ["verify", "analysis", "candidate", "context"]);
  assert.deepEqual(harness.state.error, {
    statusCode: HttpStatus.CONFLICT,
    message: "Application brief must be regenerated",
    metadata: { code: "APPLICATION_BRIEF_REFRESH_REQUIRED" },
  });
});
