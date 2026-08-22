import test from "node:test";
import assert from "node:assert/strict";
import { HttpStatus } from "../../src/constants/HttpStatus.js";
import { OfferPreparationConstants } from "../../src/constants/OfferPreparationConstants.js";
import { ApplicationBriefController } from "../../src/controllers/ApplicationBriefController.js";
import { OfferIdParser } from "../../src/controllers/OfferIdParser.js";
import { ApplicationBriefContextValidationError } from "../../src/services/ApplicationBriefContextValidationError.js";
import { ApplicationBriefMatcherError } from "../../src/services/ApplicationBriefMatcherError.js";
import { CandidateDossierServiceError } from "../../src/services/CandidateDossierServiceError.js";
import { OfferAnalysisServiceError } from "../../src/services/OfferAnalysisServiceError.js";
import { OfferAnalyzerError } from "../../src/services/OfferAnalyzerError.js";
import { OfferPreparationError } from "../../src/services/OfferPreparationError.js";

const OFFER_ID = 42;

/**
 * Build one controller harness with captured service and view calls.
 * @param {object} behavior - Fake service behavior.
 * @returns {object} Controller and captured state.
 */
function createHarness(behavior = {}) {
  const state = { ids: [], success: null, error: null };
  const result = {
    brief: { schemaVersion: "application-brief-schema-v1", inputIdentity: {} },
    generationToken: "v1.opaque-token",
  };
  const service = {
    async generateForOffer(offerId) {
      state.ids.push(offerId);
      if (behavior.error) {
        throw behavior.error;
      }
      return result;
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
    controller: new ApplicationBriefController(service, view, new OfferIdParser()),
    state,
  };
}

test("controller returns only the public brief and ignores request body inputs", async () => {
  const harness = createHarness();
  const request = {
    params: { id: String(OFFER_ID) },
    body: {
      candidateDossier: { private: true },
      offerIdentity: { private: true },
      semanticOutput: { private: true },
    },
  };
  await harness.controller.generateForOffer(request, {});
  assert.deepEqual(harness.state.ids, [OFFER_ID]);
  assert.deepEqual(harness.state.success, {
    brief: { schemaVersion: "application-brief-schema-v1", inputIdentity: {} },
    generationToken: "v1.opaque-token",
  });
});

test("controller rejects every noncanonical offer id before delegation", async () => {
  for (const rawId of ["0", "01", "-1", "1e2", "9007199254740992", "private"]) {
    const harness = createHarness();
    await harness.controller.generateForOffer({ params: { id: rawId } }, {});
    assert.deepEqual(harness.state.ids, []);
    assert.deepEqual(harness.state.error, {
      statusCode: HttpStatus.BAD_REQUEST,
      message: "Invalid offer id",
      metadata: { code: "INVALID_OFFER_ID" },
    });
  }
});

test("controller sanitizes offer not found and not ready failures", async () => {
  const cases = [
    [
      new OfferPreparationError("private", HttpStatus.NOT_FOUND),
      HttpStatus.NOT_FOUND,
      "Offer not found",
      { code: "OFFER_NOT_FOUND" },
    ],
    [
      new OfferAnalysisServiceError(OfferAnalysisServiceError.CODE.OFFER_NOT_READY, {
        prepareStatus: OfferPreparationConstants.STATUS.NEEDS_USER_TEXT,
      }),
      HttpStatus.CONFLICT,
      "Offer is not ready",
      { code: "OFFER_NOT_READY", prepareStatus: "NEEDS_USER_TEXT" },
    ],
  ];
  for (const [error, statusCode, message, metadata] of cases) {
    const harness = createHarness({ error });
    await harness.controller.generateForOffer({ params: { id: String(OFFER_ID) } }, {});
    assert.deepEqual(harness.state.error, { statusCode, message, metadata });
  }
});

test("controller maps every ApplicationBrief matcher failure", async () => {
  const cases = [
    [ApplicationBriefMatcherError.CODE.INPUT_TOO_LARGE, HttpStatus.UNPROCESSABLE_ENTITY, "Application brief input is too large"],
    [ApplicationBriefMatcherError.CODE.UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE, "Application brief service is unavailable"],
    [ApplicationBriefMatcherError.CODE.TIMEOUT, HttpStatus.SERVICE_UNAVAILABLE, "Application brief service timed out"],
    [ApplicationBriefMatcherError.CODE.RATE_LIMITED, HttpStatus.SERVICE_UNAVAILABLE, "Application brief service is temporarily unavailable"],
    [ApplicationBriefMatcherError.CODE.PROVIDER_TOKEN_BUDGET, HttpStatus.BAD_GATEWAY, "Application brief provider rejected the token budget"],
    [ApplicationBriefMatcherError.CODE.PROVIDER_ERROR, HttpStatus.BAD_GATEWAY, "Application brief provider failed"],
    [ApplicationBriefMatcherError.CODE.INVALID_OUTPUT, HttpStatus.BAD_GATEWAY, "Application brief provider returned an invalid response"],
  ];
  for (const [code, statusCode, message] of cases) {
    const harness = createHarness({ error: new ApplicationBriefMatcherError(code) });
    await harness.controller.generateForOffer({ params: { id: String(OFFER_ID) } }, {});
    assert.deepEqual(harness.state.error, { statusCode, message, metadata: { code } });
  }
});

test("controller maps OfferAnalyzer failures with the existing public taxonomy", async () => {
  const cases = [
    [OfferAnalyzerError.CODE.ANALYZER_INPUT_TOO_LARGE, HttpStatus.UNPROCESSABLE_ENTITY],
    [OfferAnalyzerError.CODE.ANALYZER_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE],
    [OfferAnalyzerError.CODE.ANALYZER_TIMEOUT, HttpStatus.SERVICE_UNAVAILABLE],
    [OfferAnalyzerError.CODE.ANALYZER_RATE_LIMITED, HttpStatus.SERVICE_UNAVAILABLE],
    [OfferAnalyzerError.CODE.ANALYZER_PROVIDER_TOKEN_BUDGET, HttpStatus.BAD_GATEWAY],
    [OfferAnalyzerError.CODE.ANALYZER_PROVIDER_ERROR, HttpStatus.BAD_GATEWAY],
    [OfferAnalyzerError.CODE.ANALYZER_INVALID_OUTPUT, HttpStatus.BAD_GATEWAY],
  ];
  for (const [code, statusCode] of cases) {
    const safeDetails = code === OfferAnalyzerError.CODE.ANALYZER_PROVIDER_ERROR
      ? {
        status: HttpStatus.BAD_REQUEST,
        providerType: "invalid_request_error",
        providerCode: "private_code",
      }
      : {};
    const harness = createHarness({ error: new OfferAnalyzerError(code, safeDetails) });
    await harness.controller.generateForOffer({ params: { id: String(OFFER_ID) } }, {});
    assert.equal(harness.state.error.statusCode, statusCode);
    assert.equal(harness.state.error.metadata.code, code);
    assert.equal(Object.hasOwn(harness.state.error.metadata, "status"), false);
    assert.equal(Object.hasOwn(harness.state.error.metadata, "providerType"), false);
    assert.equal(Object.hasOwn(harness.state.error.metadata, "providerCode"), false);
  }
});

test("controller keeps the exact public provider envelope with internal diagnostics", async () => {
  const error = new OfferAnalyzerError(
    OfferAnalyzerError.CODE.ANALYZER_PROVIDER_ERROR,
    {
      status: HttpStatus.BAD_REQUEST,
      providerType: "invalid_request_error",
      providerCode: "invalid_json_schema",
    },
  );
  const harness = createHarness({ error });
  await harness.controller.generateForOffer({ params: { id: String(OFFER_ID) } }, {});
  assert.deepEqual(harness.state.error, {
    statusCode: HttpStatus.BAD_GATEWAY,
    message: "Offer analysis provider failed",
    metadata: { code: OfferAnalyzerError.CODE.ANALYZER_PROVIDER_ERROR },
  });
});

test("controller keeps the exact public invalid-output envelope with internal diagnostics", async () => {
  const error = new OfferAnalyzerError(
    OfferAnalyzerError.CODE.ANALYZER_INVALID_OUTPUT,
    { validationCode: "EVIDENCE", validationSubcode: "EXPLICIT_EVIDENCE_TEXT_NOT_FOUND" },
  );
  const harness = createHarness({ error });
  await harness.controller.generateForOffer({ params: { id: String(OFFER_ID) } }, {});
  assert.deepEqual(harness.state.error, {
    statusCode: HttpStatus.BAD_GATEWAY,
    message: "Offer analysis provider returned an invalid response",
    metadata: { code: OfferAnalyzerError.CODE.ANALYZER_INVALID_OUTPUT },
  });
});

test("controller keeps matcher invalid-output diagnostics server-only", async () => {
  const error = new ApplicationBriefMatcherError(
    ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
    ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT,
    null,
    { validationCode: "SEMANTIC_VALIDATION", validationSubcode: "TYPE" },
  );
  const harness = createHarness({ error });
  await harness.controller.generateForOffer({ params: { id: String(OFFER_ID) } }, {});
  assert.deepEqual(harness.state.error, {
    statusCode: HttpStatus.BAD_GATEWAY,
    message: "Application brief provider returned an invalid response",
    metadata: { code: "INVALID_APPLICATION_BRIEF_OUTPUT" },
  });
  assert.deepEqual(Object.keys(harness.state.error.metadata), ["code"]);
});

test("controller exposes stale input as conflict without its internal reason", async () => {
  const error = new ApplicationBriefContextValidationError(
    ApplicationBriefContextValidationError.REASON.STALE_INPUT,
  );
  const harness = createHarness({ error });
  await harness.controller.generateForOffer({ params: { id: String(OFFER_ID) } }, {});
  assert.deepEqual(harness.state.error, {
    statusCode: HttpStatus.CONFLICT,
    message: "Application brief inputs changed",
    metadata: { code: "APPLICATION_BRIEF_STALE_INPUT" },
  });
  assert.equal(Object.hasOwn(harness.state.error, "reason"), false);
  assert.equal(Object.hasOwn(harness.state.error, "cause"), false);
});

test("controller sanitizes other context and unexpected failures", async () => {
  const failures = [
    new ApplicationBriefContextValidationError(
      ApplicationBriefContextValidationError.REASON.EVIDENCE_VALUE_MISMATCH,
    ),
    new Error("private cause"),
  ];
  for (const error of failures) {
    const harness = createHarness({ error });
    await harness.controller.generateForOffer({ params: { id: String(OFFER_ID) } }, {});
    assert.deepEqual(harness.state.error, {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal server error",
      metadata: { code: "INTERNAL_SERVER_ERROR" },
    });
    assert.equal(JSON.stringify(harness.state.error).includes("private"), false);
  }
});

test("controller sanitizes analysis and candidate persistence failures", async () => {
  const failures = [
    new OfferAnalysisServiceError(OfferAnalysisServiceError.CODE.CACHE_PERSISTENCE_ERROR),
    new CandidateDossierServiceError(CandidateDossierServiceError.CODE.PERSISTENCE_ERROR),
  ];
  for (const error of failures) {
    const harness = createHarness({ error });
    await harness.controller.generateForOffer({ params: { id: String(OFFER_ID) } }, {});
    assert.deepEqual(harness.state.error, {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal server error",
      metadata: { code: "INTERNAL_SERVER_ERROR" },
    });
  }
});
