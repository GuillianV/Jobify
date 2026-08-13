import test from "node:test";
import assert from "node:assert/strict";
import { HttpStatus } from "../../src/constants/HttpStatus.js";
import { JsonView } from "../../src/views/JsonView.js";

/**
 * Build a minimal observable Express response double.
 * @returns {object} Response double and captured state.
 */
function createResponse() {
  const state = { statusCode: null, payload: null };
  return {
    state,
    response: {
      status(statusCode) {
        state.statusCode = statusCode;
        return this;
      },
      json(payload) {
        state.payload = payload;
        return this;
      },
    },
  };
}

test("renderError preserves the historical error-only response", () => {
  const { response, state } = createResponse();
  new JsonView().renderError(response, HttpStatus.BAD_REQUEST, "Historical error");
  assert.deepEqual(state.payload, { error: "Historical error" });
});

test("renderError appends only the explicitly supplied public metadata", () => {
  const { response, state } = createResponse();
  new JsonView().renderError(response, HttpStatus.CONFLICT, "Offer is not ready", {
    code: "OFFER_NOT_READY",
    prepareStatus: "NEEDS_USER_TEXT",
  });
  assert.equal(state.statusCode, HttpStatus.CONFLICT);
  assert.deepEqual(state.payload, {
    error: "Offer is not ready",
    code: "OFFER_NOT_READY",
    prepareStatus: "NEEDS_USER_TEXT",
  });
});

test("renderError with empty metadata keeps the historical shape", () => {
  const { response, state } = createResponse();
  new JsonView().renderError(
    response,
    HttpStatus.INTERNAL_SERVER_ERROR,
    "Internal server error",
    {},
  );
  assert.deepEqual(state.payload, { error: "Internal server error" });
});
