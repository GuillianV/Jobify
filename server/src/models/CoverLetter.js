import { CoverLetterConstants } from "../constants/CoverLetterConstants.js";

/**
 * Detached immutable representation of one structurally validated cover letter.
 */
class CoverLetter {
  /**
   * Create a domain value from an already validated generated output.
   * @param {object} output - Validated provider output without schema metadata.
   */
  constructor(output) {
    const detached = structuredClone(output);
    this.schemaVersion = CoverLetterConstants.SCHEMA_VERSION;
    this.letter = detached.letter;
    this.usedClaimIndexes = detached.usedClaimIndexes;
    Object.freeze(this.usedClaimIndexes);
    Object.freeze(this);
  }

  /**
   * Return an independent exact CoverLetter V1 representation.
   * @returns {object} Detached final domain value.
   */
  toJson() {
    return structuredClone({
      schemaVersion: this.schemaVersion,
      letter: this.letter,
      usedClaimIndexes: this.usedClaimIndexes,
    });
  }
}

export { CoverLetter };
