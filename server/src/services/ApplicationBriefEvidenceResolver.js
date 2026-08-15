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
      this.fail();
    }
    const arrayMatch = ARRAY_FIELD_PATTERN.exec(reference.field);
    const value = arrayMatch
      ? this.resolveArrayField(item, arrayMatch[1], Number(arrayMatch[2]))
      : item[reference.field];
    if (value === null || value === undefined) {
      this.fail();
    }
    return value;
  }

  /**
   * Resolve one indexed candidate fact without accepting a missing element.
   * @param {object} item - Resolved candidate collection item.
   * @param {string} field - Candidate array field.
   * @param {number} index - Structurally valid index.
   * @returns {string} Exact indexed candidate fact.
   */
  resolveArrayField(item, field, index) {
    if (!Array.isArray(item[field]) || index >= item[field].length) {
      this.fail();
    }
    return item[field][index];
  }

  /**
   * Throw the closed invalid-evidence-reference failure.
   * @returns {never}
   */
  fail() {
    throw new ApplicationBriefContextValidationError(
      ApplicationBriefContextValidationError.REASON.INVALID_EVIDENCE_REFERENCE,
    );
  }
}

export { ApplicationBriefEvidenceResolver };
