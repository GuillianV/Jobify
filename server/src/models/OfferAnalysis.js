/**
 * Detached semantic representation of one offer after validation.
 */
class OfferAnalysis {
  /**
   * Create an analysis from an already validated semantic value.
   * @param {object} value - Validated OfferAnalysis V1 value.
   */
  constructor(value) {
    const detached = structuredClone(value);
    this.seniority = detached.seniority;
    this.activities = detached.activities;
    this.requirements = detached.requirements;
    this.context = detached.context;
    this.workConditions = detached.workConditions;
  }

  /**
   * Return a detached plain representation of the semantic contract.
   * @returns {object} Independent OfferAnalysis V1 value.
   */
  toJson() {
    return structuredClone({
      seniority: this.seniority,
      activities: this.activities,
      requirements: this.requirements,
      context: this.context,
      workConditions: this.workConditions,
    });
  }
}

export { OfferAnalysis };
