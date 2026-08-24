import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationBriefContextValidationError } from "../../src/services/ApplicationBriefContextValidationError.js";

test("context error exposes exactly five closed evidence resolver categories", () => {
  assert.deepEqual(
    Object.values(ApplicationBriefContextValidationError.EVIDENCE_REFERENCE_FAILURE),
    [
      "ITEM_NOT_FOUND_FOR_KIND", "FIELD_NOT_PRESENT", "FIELD_VALUE_NULL_OR_UNDEFINED",
      "INDEXED_COLLECTION_NOT_PRESENT", "INDEX_NOT_FOUND",
    ],
  );
  assert.deepEqual(
    Object.values(ApplicationBriefContextValidationError.EVIDENCE_FIELD_CLASS),
    ["SCALAR", "INDEXED"],
  );
});

test("context error retains only one complete safe evidence diagnostic triplet", () => {
  const error = new ApplicationBriefContextValidationError(
    ApplicationBriefContextValidationError.REASON.INVALID_EVIDENCE_REFERENCE,
    {
      evidenceReferenceFailure: "FIELD_VALUE_NULL_OR_UNDEFINED",
      evidenceKind: "SKILL",
      evidenceFieldClass: "SCALAR",
      itemId: "private-item",
      field: "private-field",
      value: "private-value",
    },
  );
  assert.deepEqual(error.safeDetails, {
    evidenceReferenceFailure: "FIELD_VALUE_NULL_OR_UNDEFINED",
    evidenceKind: "SKILL",
    evidenceFieldClass: "SCALAR",
  });
  assert.equal(Object.isFrozen(error.safeDetails), true);

  for (const invalid of [
    { evidenceReferenceFailure: "KIND_ITEM_MISMATCH", evidenceKind: "SKILL", evidenceFieldClass: "SCALAR" },
    { evidenceReferenceFailure: "ITEM_NOT_FOUND_FOR_KIND", evidenceKind: "UNKNOWN", evidenceFieldClass: "SCALAR" },
    { evidenceReferenceFailure: "ITEM_NOT_FOUND_FOR_KIND", evidenceKind: "SKILL", evidenceFieldClass: "UNKNOWN" },
  ]) {
    assert.deepEqual(
      new ApplicationBriefContextValidationError(
        ApplicationBriefContextValidationError.REASON.INVALID_EVIDENCE_REFERENCE,
        invalid,
      ).safeDetails,
      {},
    );
  }
});

test("non-evidence contextual errors never retain evidence diagnostics", () => {
  const error = new ApplicationBriefContextValidationError(
    ApplicationBriefContextValidationError.REASON.INVALID_OFFER_REFERENCE,
    {
      evidenceReferenceFailure: "ITEM_NOT_FOUND_FOR_KIND",
      evidenceKind: "SKILL",
      evidenceFieldClass: "SCALAR",
    },
  );
  assert.deepEqual(error.safeDetails, {});
});
