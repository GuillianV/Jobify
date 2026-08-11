/**
 * Applies predictable synthetic-text normalization and internal deduplication.
 */
class OfferAnalysisNormalizer {
  /**
   * Normalize one structurally valid analysis without mutating its input.
   * @param {object} analysis - Structurally valid raw analysis.
   * @returns {object} Normalized and lightly deduplicated analysis.
   */
  normalize(analysis) {
    const normalized = {
      seniority: this.normalizeSeniority(analysis.seniority),
      activities: this.normalizeItems(
        analysis.activities,
        this.buildAssertionValueKey,
      ),
      requirements: this.normalizeItems(analysis.requirements, this.buildRequirementKey),
      context: this.normalizeItems(
        analysis.context,
        this.buildAssertionCategorizedKey,
      ),
      workConditions: {
        workMode: this.normalizeWorkMode(analysis.workConditions.workMode),
        constraints: this.normalizeItems(
          analysis.workConditions.constraints,
          this.buildCategorizedKey,
        ),
      },
    };
    return normalized;
  }

  /**
   * Normalize a synthetic string by trimming and collapsing whitespace.
   * @param {string} value - Synthetic value.
   * @returns {string} Normalized string.
   */
  normalizeSyntheticText(value) {
    return value.trim().replace(/\s+/gu, " ");
  }

  /**
   * Normalize and deduplicate one item collection while preserving first spelling.
   * @param {object[]} items - Structurally valid items.
   * @param {Function} keyBuilder - Deduplication key builder.
   * @returns {object[]} Normalized non-empty items.
   */
  normalizeItems(items, keyBuilder) {
    const normalized = [];
    const keys = new Set();
    for (const item of items) {
      const candidate = {
        ...structuredClone(item),
        value: this.normalizeSyntheticText(item.value),
      };
      if (!candidate.value) {
        continue;
      }
      const key = keyBuilder.call(this, candidate);
      if (keys.has(key)) {
        continue;
      }
      keys.add(key);
      normalized.push(candidate);
    }
    return normalized;
  }

  /**
   * Normalize seniority levels and preserve assertion evidence exactly.
   * @param {object|null} seniority - Structurally valid seniority.
   * @returns {object|null} Normalized seniority.
   */
  normalizeSeniority(seniority) {
    if (seniority === null) {
      return null;
    }
    const levels = [];
    const seen = new Set();
    for (const level of seniority.levels) {
      const key = this.buildComparableText(level);
      if (!seen.has(key)) {
        seen.add(key);
        levels.push(level);
      }
    }
    return {
      ...structuredClone(seniority),
      levels,
    };
  }

  /**
   * Normalize optional work-mode detail without changing evidence.
   * @param {object|null} workMode - Structurally valid work mode.
   * @returns {object|null} Normalized work mode.
   */
  normalizeWorkMode(workMode) {
    if (workMode === null) {
      return null;
    }
    return {
      ...structuredClone(workMode),
      detail: workMode.detail === null
        ? null
        : this.normalizeSyntheticText(workMode.detail) || null,
    };
  }

  /**
   * Build an accent-insensitive and case-insensitive comparable string.
   * @param {string} value - Normalized synthetic text.
   * @returns {string} Comparable text.
   */
  buildComparableText(value) {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase();
  }

  /**
   * Build a value-only item deduplication key.
   * @param {object} item - Normalized analysis item.
   * @returns {string} Deduplication key.
   */
  buildValueKey(item) {
    return this.buildComparableText(item.value);
  }

  /**
   * Build an assertion-aware value key for families allowing factuality variants.
   * @param {object} item - Normalized analysis item.
   * @returns {string} Deduplication key.
   */
  buildAssertionValueKey(item) {
    return [item.assertion, this.buildValueKey(item)].join("|");
  }

  /**
   * Build a category-aware item deduplication key.
   * @param {object} item - Normalized categorized item.
   * @returns {string} Deduplication key.
   */
  buildCategorizedKey(item) {
    return [item.category, this.buildComparableText(item.value)].join("|");
  }

  /**
   * Build an assertion-aware categorized key for context factuality variants.
   * @param {object} item - Normalized context item.
   * @returns {string} Deduplication key.
   */
  buildAssertionCategorizedKey(item) {
    return [item.category, item.assertion, this.buildComparableText(item.value)].join("|");
  }

  /**
   * Build a conservative requirement key that preserves differing importance.
   * @param {object} item - Normalized requirement.
   * @returns {string} Deduplication key.
   */
  buildRequirementKey(item) {
    return [
      item.category,
      item.importance,
      this.buildComparableText(item.value),
    ].join("|");
  }
}

export { OfferAnalysisNormalizer };
