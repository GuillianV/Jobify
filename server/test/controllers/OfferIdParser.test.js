import test from "node:test";
import assert from "node:assert/strict";
import { HttpStatus } from "../../src/constants/HttpStatus.js";
import { OfferIdParser } from "../../src/controllers/OfferIdParser.js";
import { OfferPreparationError } from "../../src/services/OfferPreparationError.js";

const OFFER_ID = 42;

test("shared offer id parser accepts only canonical positive safe decimal strings", () => {
  const parser = new OfferIdParser();
  assert.equal(parser.parse(String(OFFER_ID)), OFFER_ID);
  for (const rawId of [
    "0", "01", "-1", "1.5", "1e2", "9007199254740992", "private", null, undefined,
  ]) {
    assert.throws(() => {
      parser.parse(rawId);
    }, (error) => {
      return error instanceof OfferPreparationError
        && error.statusCode === HttpStatus.BAD_REQUEST
        && error.message === "Invalid offer id";
    });
  }
});
