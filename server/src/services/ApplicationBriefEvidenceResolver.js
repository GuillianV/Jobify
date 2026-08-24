import { ApplicationBriefConstants } from "../constants/ApplicationBriefConstants.js";
import { ApplicationBriefContextValidationError } from "./ApplicationBriefContextValidationError.js";

const ARRAY_FIELD_PATTERN = /^(activities|achievements|technologies)\[(0|[1-9]\d*)\]$/u;

/**
 * Resolves structurally valid evidence references against authoritative candidate facts.
 */
class ApplicationBriefEvidenceResolver {
  /**
   * Resolve one evidence reference to its exact non-null candidate value.
   * @param {import("../models/CandidateDossier.js").CandidateDossier} candidateDossier - Candidate facts.
   * @param {object} reference - Structurally valid evidence reference.
   * @returns {string|boolean} Exact referenced candidate value.
   */
  resolve(candidateDossier, reference) {
    const kinds = ApplicationBriefConstants.EVIDENCE_KIND;
    const fieldClass = ARRAY_FIELD_PATTERN.test(reference.field)
      ? ApplicationBriefContextValidationError.EVIDENCE_FIELD_CLASS.INDEXED
      : ApplicationBriefContextValidationError.EVIDENCE_FIELD_CLASS.SCALAR;
    const collectionByKind = {
      [kinds.EXPERIENCE]: candidateDossier.experiences,
      [kinds.PROJECT]: candidateDossier.projects,
      [kinds.SKILL]: candidateDossier.skills,
      [kinds.EDUCATION]: candidateDossier.education,
      [kinds.LANGUAGE]: candidateDossier.languages,
      [kinds.SOFT_SKILL]: candidateDossier.softSkills,
    };
    const collection = collectionByKind[reference.kind];
    const item = collection.find((candidate) => {
      return candidate.id === reference.itemId;
    });
    if (item === undefined) {
      this.fail(
        ApplicationBriefContextValidationError.EVIDENCE_REFERENCE_FAILURE
          .ITEM_NOT_FOUND_FOR_KIND,
        reference.kind,
        fieldClass,
      );
    }
    const arrayMatch = ARRAY_FIELD_PATTERN.exec(reference.field);
    if (arrayMatch) {
      return this.resolveArrayField(
        item,
        arrayMatch[1],
        Number(arrayMatch[2]),
        reference.kind,
      );
    }
    if (!Object.hasOwn(item, reference.field)) {
      this.fail(
        ApplicationBriefContextValidationError.EVIDENCE_REFERENCE_FAILURE.FIELD_NOT_PRESENT,
        reference.kind,
        fieldClass,
      );
    }
    const value = item[reference.field];
    if (value === null || value === undefined) {
      this.fail(
        ApplicationBriefContextValidationError.EVIDENCE_REFERENCE_FAILURE
          .FIELD_VALUE_NULL_OR_UNDEFINED,
        reference.kind,
        fieldClass,
      );
    }
    return value;
  }

  /**
   * Resolve one indexed candidate fact without accepting a missing element.
   * @param {object} item - Resolved candidate collection item.
   * @param {string} field - Candidate array field.
   * @param {number} index - Structurally valid index.
   * @param {string} evidenceKind - Closed candidate evidence kind.
   * @returns {string} Exact indexed candidate fact.
   */
  resolveArrayField(item, field, index, evidenceKind) {
    const fieldClass = ApplicationBriefContextValidationError.EVIDENCE_FIELD_CLASS.INDEXED;
    if (!Array.isArray(item[field])) {
      this.fail(
        ApplicationBriefContextValidationError.EVIDENCE_REFERENCE_FAILURE
          .INDEXED_COLLECTION_NOT_PRESENT,
        evidenceKind,
        fieldClass,
      );
    }
    const value = item[field][index];
    if (index >= item[field].length || value === null || value === undefined) {
      this.fail(
        ApplicationBriefContextValidationError.EVIDENCE_REFERENCE_FAILURE.INDEX_NOT_FOUND,
        evidenceKind,
        fieldClass,
      );
    }
    return value;
  }

  /**
   * Throw the closed invalid-evidence-reference failure.
   * @param {string} failure - Closed resolver failure category.
   * @param {string} evidenceKind - Closed candidate evidence kind.
   * @param {string} evidenceFieldClass - Closed scalar/indexed distinction.
   * @returns {never}
   */
  fail(failure, evidenceKind, evidenceFieldClass) {
    throw new ApplicationBriefContextValidationError(
      ApplicationBriefContextValidationError.REASON.INVALID_EVIDENCE_REFERENCE,
      {
        evidenceReferenceFailure: failure,
        evidenceKind,
        evidenceFieldClass,
      },
    );
  }
}

export { ApplicationBriefEvidenceResolver };
