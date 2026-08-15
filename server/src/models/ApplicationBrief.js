/**
 * Detached immutable representation of one structurally validated application brief.
 */
class ApplicationBrief {
  /**
   * Create a brief from an already validated ApplicationBrief V1 value.
   * @param {object} value - Validated brief value.
   */
  constructor(value) {
    const detached = structuredClone(value);
    Object.assign(this, detached);
    this.deepFreeze(this);
  }

  /**
   * Return an independent plain representation preserving caller array order.
   * @returns {object} Detached ApplicationBrief V1 value.
   */
  toJson() {
    return structuredClone({
      schemaVersion: this.schemaVersion,
      inputIdentity: this.inputIdentity,
      requirementMatches: this.requirementMatches,
      evidenceFacts: this.evidenceFacts,
      emphasis: this.emphasis,
      supportedClaims: this.supportedClaims,
      cautions: this.cautions,
    });
  }

  /**
   * Recursively freeze one detached JSON-compatible value.
   * @param {unknown} value - Value owned by this domain object.
   * @returns {unknown} Frozen value.
   */
  deepFreeze(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
      for (const child of Object.values(value)) {
        this.deepFreeze(child);
      }
      Object.freeze(value);
    }
    return value;
  }
}

export { ApplicationBrief };
