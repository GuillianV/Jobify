import { ApplicationBriefConstants } from "../constants/ApplicationBriefConstants.js";

/**
 * Signals that a structurally valid ApplicationBrief contradicts its authoritative inputs.
 */
class ApplicationBriefContextValidationError extends TypeError {
  static CODE = "INVALID_APPLICATION_BRIEF_CONTEXT";

  static REASON = Object.freeze({
    INVALID_OFFER_REFERENCE: "INVALID_OFFER_REFERENCE",
    INVALID_EVIDENCE_REFERENCE: "INVALID_EVIDENCE_REFERENCE",
    EVIDENCE_VALUE_MISMATCH: "EVIDENCE_VALUE_MISMATCH",
    FACET_NOT_IN_REQUIREMENT: "FACET_NOT_IN_REQUIREMENT",
    INCOMPLETE_REQUIREMENT_COVERAGE: "INCOMPLETE_REQUIREMENT_COVERAGE",
    MISSING_SUPPORTED_CLAIMS_WITH_POSITIVE_EVIDENCE:
      "MISSING_SUPPORTED_CLAIMS_WITH_POSITIVE_EVIDENCE",
    STALE_INPUT: "STALE_INPUT",
  });

  static EVIDENCE_REFERENCE_FAILURE = Object.freeze({
    ITEM_NOT_FOUND_FOR_KIND: "ITEM_NOT_FOUND_FOR_KIND",
    FIELD_NOT_PRESENT: "FIELD_NOT_PRESENT",
    FIELD_VALUE_NULL_OR_UNDEFINED: "FIELD_VALUE_NULL_OR_UNDEFINED",
    INDEXED_COLLECTION_NOT_PRESENT: "INDEXED_COLLECTION_NOT_PRESENT",
    INDEX_NOT_FOUND: "INDEX_NOT_FOUND",
  });

  static EVIDENCE_FIELD_CLASS = Object.freeze({
    SCALAR: "SCALAR",
    INDEXED: "INDEXED",
  });

  /**
   * Create one controlled contextual contract violation without input data.
   * @param {string} reason - Closed internal contextual reason.
   * @param {object} [safeDetails] - Closed evidence-resolution diagnostics.
   */
  constructor(reason, safeDetails = {}) {
    if (!Object.values(ApplicationBriefContextValidationError.REASON).includes(reason)) {
      throw new TypeError("Unknown ApplicationBrief context validation reason");
    }
    super(ApplicationBriefContextValidationError.CODE);
    this.name = "ApplicationBriefContextValidationError";
    this.code = ApplicationBriefContextValidationError.CODE;
    this.reason = reason;
    this.safeDetails = Object.freeze(
      reason === ApplicationBriefContextValidationError.REASON.INVALID_EVIDENCE_REFERENCE
        ? ApplicationBriefContextValidationError.createEvidenceSafeDetails(safeDetails)
        : {},
    );
  }

  /**
   * Retain only one complete closed evidence-resolution diagnostic triplet.
   * @param {unknown} safeDetails - Untrusted diagnostic candidates.
   * @returns {object} Closed safe evidence-resolution details or an empty object.
   */
  static createEvidenceSafeDetails(safeDetails) {
    const validObject = safeDetails !== null
      && typeof safeDetails === "object"
      && !Array.isArray(safeDetails);
    if (!validObject
      || !Object.values(this.EVIDENCE_REFERENCE_FAILURE)
        .includes(safeDetails.evidenceReferenceFailure)
      || !Object.values(ApplicationBriefConstants.EVIDENCE_KIND)
        .includes(safeDetails.evidenceKind)
      || !Object.values(this.EVIDENCE_FIELD_CLASS)
        .includes(safeDetails.evidenceFieldClass)) {
      return {};
    }
    return {
      evidenceReferenceFailure: safeDetails.evidenceReferenceFailure,
      evidenceKind: safeDetails.evidenceKind,
      evidenceFieldClass: safeDetails.evidenceFieldClass,
    };
  }
}

export { ApplicationBriefContextValidationError };
