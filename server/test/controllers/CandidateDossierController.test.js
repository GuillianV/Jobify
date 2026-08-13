import test from "node:test";
import assert from "node:assert/strict";
import { HttpStatus } from "../../src/constants/HttpStatus.js";
import { CandidateDossier } from "../../src/models/CandidateDossier.js";
import { CandidateDossierController } from "../../src/controllers/CandidateDossierController.js";
import { CandidateDossierServiceError } from "../../src/services/CandidateDossierServiceError.js";
import { CandidateDossierValidationError } from "../../src/services/CandidateDossierValidationError.js";

const UPDATED_AT = "2026-08-13T10:20:30.000Z";

/**
 * Build a controller harness that captures its exact public rendering calls.
 * @param {object} service - Candidate dossier service fake.
 * @returns {object} Controller and captured rendering state.
 */
function createHarness(service) {
  const state = { success: null, error: null };
  const view = {
    renderSuccess(response, payload) {
      state.success = payload;
    },
    renderError(response, statusCode, message, publicMetadata) {
      state.error = { statusCode, message, publicMetadata };
    },
  };
  return {
    controller: new CandidateDossierController(service, view),
    state,
  };
}

/**
 * Build a non-empty valid domain object without duplicating validation policy.
 * @returns {CandidateDossier} Generic immutable dossier.
 */
function createExistingDossier() {
  const value = CandidateDossier.empty().toJson();
  value.softSkills.push({ id: "soft-1", value: "Generic fact", detail: null });
  return new CandidateDossier(value);
}

test("GET renders the exact official empty dossier envelope", () => {
  const harness = createHarness({
    get() {
      return { dossier: CandidateDossier.empty(), updatedAt: null };
    },
  });

  harness.controller.getDossier({}, {});

  assert.deepEqual(harness.state.success, {
    dossier: CandidateDossier.empty().toJson(),
    updatedAt: null,
  });
});

test("GET renders an existing dossier and whitelists service metadata", () => {
  const dossier = createExistingDossier();
  const harness = createHarness({
    get() {
      return {
        dossier,
        updatedAt: UPDATED_AT,
        fingerprint: "private",
        revision: "private",
        internal: "private",
      };
    },
  });

  harness.controller.getDossier({}, {});

  assert.deepEqual(harness.state.success, {
    dossier: dossier.toJson(),
    updatedAt: UPDATED_AT,
  });
});

test("PUT forwards the direct request body unchanged and returns HTTP success data", () => {
  const body = CandidateDossier.empty().toJson();
  const dossier = createExistingDossier();
  let received = null;
  const harness = createHarness({
    save(rawDossier) {
      received = rawDossier;
      return { dossier, updatedAt: UPDATED_AT, internal: "private" };
    },
  });

  harness.controller.saveDossier({ body }, {});

  assert.equal(received, body);
  assert.deepEqual(harness.state.success, {
    dossier: dossier.toJson(),
    updatedAt: UPDATED_AT,
  });
});

test("PUT maps user validation to a sanitized 422 response", () => {
  const validationError = new CandidateDossierValidationError({
    validationCode: CandidateDossierValidationError.CODE.INVALID_ENUM,
    validationSubcode: CandidateDossierValidationError.ENUM_SUBCODE.SKILL_CATEGORY,
    message: "sensitive validation details",
  });
  const harness = createHarness({
    save() {
      throw validationError;
    },
  });

  harness.controller.saveDossier({ body: { sensitive: "payload" } }, {});

  assert.deepEqual(harness.state.error, {
    statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    message: "Candidate dossier is invalid",
    publicMetadata: { code: "INVALID_CANDIDATE_DOSSIER" },
  });
  const serialized = JSON.stringify(harness.state.error);
  for (const privateValue of ["validationCode", "validationSubcode", "sensitive", "payload"]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("GET and PUT map persistence failures to the same sanitized 500 response", () => {
  const error = new CandidateDossierServiceError(
    CandidateDossierServiceError.CODE.PERSISTENCE_ERROR,
    new Error("sensitive SQL payload"),
  );
  for (const method of ["getDossier", "saveDossier"]) {
    const harness = createHarness({
      get() {
        throw error;
      },
      save() {
        throw error;
      },
    });
    harness.controller[method]({ body: {} }, {});
    assert.deepEqual(harness.state.error, {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal server error",
      publicMetadata: { code: "CANDIDATE_DOSSIER_PERSISTENCE_ERROR" },
    });
    const serialized = JSON.stringify(harness.state.error);
    for (const privateValue of ["cause", "SQL", "payload", "stack"]) {
      assert.equal(serialized.includes(privateValue), false);
    }
  }
});

test("unexpected failures map to a sanitized generic 500 response", () => {
  const harness = createHarness({
    get() {
      throw new Error("sensitive-internal-message");
    },
  });

  harness.controller.getDossier({}, {});

  assert.deepEqual(harness.state.error, {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    message: "Internal server error",
    publicMetadata: { code: "INTERNAL_SERVER_ERROR" },
  });
  const serialized = JSON.stringify(harness.state.error);
  assert.equal(serialized.includes("sensitive-internal-message"), false);
  assert.equal(serialized.includes("stack"), false);
});
