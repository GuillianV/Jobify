/**
 * Stable safe failure raised by ApplicationBrief semantic matching components.
 */
class ApplicationBriefMatcherError extends Error {
  static VALIDATION_CATEGORY = Object.freeze({
    TEXT: "TEXT",
    IDENTIFIER_ITEM_ID: "IDENTIFIER_ITEM_ID",
    IDENTIFIER_FIELD: "IDENTIFIER_FIELD",
  });

  static VALIDATION_RULE = Object.freeze({
    TEXT_NOT_STRING: "TEXT_NOT_STRING",
    TEXT_BLANK: "TEXT_BLANK",
    TEXT_TOO_LONG: "TEXT_TOO_LONG",
    ITEM_ID_NOT_STRING: "ITEM_ID_NOT_STRING",
    ITEM_ID_EMPTY: "ITEM_ID_EMPTY",
    ITEM_ID_TOO_LONG: "ITEM_ID_TOO_LONG",
    ITEM_ID_INVALID_CHARSET: "ITEM_ID_INVALID_CHARSET",
    FIELD_NOT_STRING: "FIELD_NOT_STRING",
    FIELD_UNKNOWN_SCALAR: "FIELD_UNKNOWN_SCALAR",
    FIELD_INVALID_INDEXED_SYNTAX: "FIELD_INVALID_INDEXED_SYNTAX",
    FIELD_KIND_INCOMPATIBLE: "FIELD_KIND_INCOMPATIBLE",
    FIELD_INDEX_OUT_OF_NORMATIVE_RANGE: "FIELD_INDEX_OUT_OF_NORMATIVE_RANGE",
  });

  static CODE = Object.freeze({
    INVALID_OUTPUT: "INVALID_APPLICATION_BRIEF_OUTPUT",
    INPUT_TOO_LARGE: "APPLICATION_BRIEF_INPUT_TOO_LARGE",
    UNAVAILABLE: "APPLICATION_BRIEF_UNAVAILABLE",
    TIMEOUT: "APPLICATION_BRIEF_TIMEOUT",
    RATE_LIMITED: "APPLICATION_BRIEF_RATE_LIMITED",
    PROVIDER_TOKEN_BUDGET: "APPLICATION_BRIEF_PROVIDER_TOKEN_BUDGET",
    PROVIDER_ERROR: "APPLICATION_BRIEF_PROVIDER_ERROR",
  });

  static REASON = Object.freeze({
    INVALID_SEMANTIC_OUTPUT: "INVALID_SEMANTIC_OUTPUT",
    INVALID_CONTEXTUAL_OUTPUT: "INVALID_CONTEXTUAL_OUTPUT",
    RATE_LIMIT_HEADROOM_SKIP: "CROSS_CLASS_RETRY_SKIPPED_TOKEN_HEADROOM",
  });

  static VALIDATION_CODE = Object.freeze({
    PROVIDER_INVALID_RESPONSE: "PROVIDER_INVALID_RESPONSE",
    SEMANTIC_VALIDATION: "SEMANTIC_VALIDATION",
    CONTEXTUAL_VALIDATION: "CONTEXTUAL_VALIDATION",
  });

  static SEMANTIC_VALIDATION_SUBCODE = Object.freeze({
    ROOT_SHAPE_OR_KEYS: "ROOT_SHAPE_OR_KEYS",
    NESTED_SHAPE_OR_KEYS: "NESTED_SHAPE_OR_KEYS",
    TYPE: "TYPE",
    ENUM: "ENUM",
    TEXT_OR_IDENTIFIER_FORMAT: "TEXT_OR_IDENTIFIER_FORMAT",
    CARDINALITY: "CARDINALITY",
    DUPLICATE: "DUPLICATE",
    STATE_FACET_INVARIANT: "STATE_FACET_INVARIANT",
    CLAIM_EVIDENCE_KIND_MISMATCH: "CLAIM_EVIDENCE_KIND_MISMATCH",
    EVIDENCE_GLOBAL_LIMIT: "EVIDENCE_GLOBAL_LIMIT",
  });

  static CARDINALITY_RULE = Object.freeze({
    ROOT_REQUIREMENT_MATCHES_MAX: "ROOT_REQUIREMENT_MATCHES_MAX",
    ROOT_EMPHASIS_MAX: "ROOT_EMPHASIS_MAX",
    ROOT_SUPPORTED_CLAIMS_MAX: "ROOT_SUPPORTED_CLAIMS_MAX",
    ROOT_CAUTIONS_MAX: "ROOT_CAUTIONS_MAX",
    REQUIREMENT_SUPPORTED_FACETS_MAX: "REQUIREMENT_SUPPORTED_FACETS_MAX",
    REQUIREMENT_NOT_EVIDENCED_FACETS_MAX: "REQUIREMENT_NOT_EVIDENCED_FACETS_MAX",
    REQUIREMENT_COMBINED_FACETS_MAX: "REQUIREMENT_COMBINED_FACETS_MAX",
    REQUIREMENT_UNIQUE_SUPPORTED_EVIDENCE_REFS_MAX:
      "REQUIREMENT_UNIQUE_SUPPORTED_EVIDENCE_REFS_MAX",
    SUPPORTED_FACET_EVIDENCE_REFS_MIN_ONE: "SUPPORTED_FACET_EVIDENCE_REFS_MIN_ONE",
    SUPPORTED_FACET_EVIDENCE_REFS_MAX: "SUPPORTED_FACET_EVIDENCE_REFS_MAX",
    EMPHASIS_OFFER_REFS_MIN_ONE: "EMPHASIS_OFFER_REFS_MIN_ONE",
    EMPHASIS_OFFER_REFS_MAX: "EMPHASIS_OFFER_REFS_MAX",
    EMPHASIS_EVIDENCE_REFS_MIN_ONE: "EMPHASIS_EVIDENCE_REFS_MIN_ONE",
    EMPHASIS_EVIDENCE_REFS_MAX: "EMPHASIS_EVIDENCE_REFS_MAX",
    SUPPORTED_CLAIM_OFFER_REFS_MIN_ONE: "SUPPORTED_CLAIM_OFFER_REFS_MIN_ONE",
    SUPPORTED_CLAIM_OFFER_REFS_MAX: "SUPPORTED_CLAIM_OFFER_REFS_MAX",
    SUPPORTED_CLAIM_EVIDENCE_REFS_MIN_ONE: "SUPPORTED_CLAIM_EVIDENCE_REFS_MIN_ONE",
    SUPPORTED_CLAIM_EVIDENCE_REFS_MAX: "SUPPORTED_CLAIM_EVIDENCE_REFS_MAX",
    CAUTION_OFFER_REFS_MIN_ONE: "CAUTION_OFFER_REFS_MIN_ONE",
    CAUTION_OFFER_REFS_MAX: "CAUTION_OFFER_REFS_MAX",
    CAUTION_EVIDENCE_REFS_MIN_ONE: "CAUTION_EVIDENCE_REFS_MIN_ONE",
    CAUTION_EVIDENCE_REFS_MAX: "CAUTION_EVIDENCE_REFS_MAX",
  });

  static NESTED_SHAPE_RULE = Object.freeze({
    REQUIREMENT_MATCH_OBJECT_SHAPE: "REQUIREMENT_MATCH_OBJECT_SHAPE",
    REQUIREMENT_MATCH_EXACT_KEYS: "REQUIREMENT_MATCH_EXACT_KEYS",
    SUPPORTED_FACET_SHAPE: "SUPPORTED_FACET_SHAPE",
    NOT_EVIDENCED_FACET_SHAPE: "NOT_EVIDENCED_FACET_SHAPE",
    EMPHASIS_SHAPE: "EMPHASIS_SHAPE",
    SUPPORTED_CLAIM_SHAPE: "SUPPORTED_CLAIM_SHAPE",
    CAUTION_SHAPE: "CAUTION_SHAPE",
    OFFER_REF_INDEXED_SHAPE: "OFFER_REF_INDEXED_SHAPE",
    OFFER_REF_SENIORITY_SHAPE: "OFFER_REF_SENIORITY_SHAPE",
    EVIDENCE_REF_SHAPE: "EVIDENCE_REF_SHAPE",
  });

  /**
   * Create a matcher failure without retaining prompt or candidate content.
   * @param {string} code - Stable matcher failure code and safe message.
   * @param {string|null} [reason] - Closed internal reason when applicable.
   * @param {Error|null} [cause] - Internal technical cause.
   * @param {object} [safeDetails] - Closed technical validation diagnostics.
   */
  constructor(code, reason = null, cause = null, safeDetails = {}) {
    super(code, cause ? { cause } : undefined);
    this.name = "ApplicationBriefMatcherError";
    this.code = code;
    this.reason = reason;
    this.safeDetails = ApplicationBriefMatcherError.createSafeDetails(
      safeDetails?.validationCode,
      safeDetails?.validationSubcode,
      safeDetails?.validationPath,
      safeDetails?.validationCategory,
      safeDetails?.validationRule,
      safeDetails?.cardinalityRule,
      safeDetails?.nestedShapeRule,
    );
  }

  /**
   * Accept only contextually coherent closed diagnostic identifiers.
   * @param {unknown} validationCode - Validation category candidate.
   * @param {unknown} validationSubcode - Validation detail candidate.
   * @param {unknown} validationPath - Closed structural output path candidate.
   * @param {unknown} validationCategory - Closed field category candidate.
   * @param {unknown} validationRule - Closed deterministic rule candidate.
   * @param {unknown} cardinalityRule - Closed cardinality predicate candidate.
   * @param {unknown} nestedShapeRule - Closed nested-shape predicate candidate.
   * @returns {object} Safe closed validation details.
   */
  static createSafeDetails(
    validationCode,
    validationSubcode,
    validationPath,
    validationCategory,
    validationRule,
    cardinalityRule,
    nestedShapeRule,
  ) {
    if (!Object.values(ApplicationBriefMatcherError.VALIDATION_CODE)
      .includes(validationCode)) {
      return { validationCode: null, validationSubcode: null };
    }
    const semanticCode = ApplicationBriefMatcherError
      .VALIDATION_CODE.SEMANTIC_VALIDATION;
    const safeSubcode = validationCode === semanticCode
      && Object.values(ApplicationBriefMatcherError.SEMANTIC_VALIDATION_SUBCODE)
        .includes(validationSubcode)
      ? validationSubcode
      : null;
    const details = { validationCode, validationSubcode: safeSubcode };
    if (this.hasCoherentStructuralDetails(
      safeSubcode,
      validationPath,
      validationCategory,
      validationRule,
    )) {
      details.validationPath = validationPath;
      details.validationCategory = validationCategory;
      details.validationRule = validationRule;
    }
    if (safeSubcode === this.SEMANTIC_VALIDATION_SUBCODE.CARDINALITY
      && Object.values(this.CARDINALITY_RULE).includes(cardinalityRule)) {
      details.cardinalityRule = cardinalityRule;
    }
    if (safeSubcode === this.SEMANTIC_VALIDATION_SUBCODE.NESTED_SHAPE_OR_KEYS
      && Object.values(this.NESTED_SHAPE_RULE).includes(nestedShapeRule)) {
      details.nestedShapeRule = nestedShapeRule;
    }
    return details;
  }

  /**
   * Accept only coherent closed structural diagnostics produced by semantic traversal.
   * @param {unknown} validationSubcode - Sanitized semantic subcode.
   * @param {unknown} validationPath - Structural path candidate.
   * @param {unknown} validationCategory - Field category candidate.
   * @param {unknown} validationRule - Rule candidate.
   * @returns {boolean} Whether all structural details are safe and coherent.
   */
  static hasCoherentStructuralDetails(
    validationSubcode,
    validationPath,
    validationCategory,
    validationRule,
  ) {
    const categories = this.VALIDATION_CATEGORY;
    const rules = this.VALIDATION_RULE;
    const ruleCategories = new Map([
      [rules.TEXT_NOT_STRING, categories.TEXT],
      [rules.TEXT_BLANK, categories.TEXT],
      [rules.TEXT_TOO_LONG, categories.TEXT],
      [rules.ITEM_ID_NOT_STRING, categories.IDENTIFIER_ITEM_ID],
      [rules.ITEM_ID_EMPTY, categories.IDENTIFIER_ITEM_ID],
      [rules.ITEM_ID_TOO_LONG, categories.IDENTIFIER_ITEM_ID],
      [rules.ITEM_ID_INVALID_CHARSET, categories.IDENTIFIER_ITEM_ID],
      [rules.FIELD_NOT_STRING, categories.IDENTIFIER_FIELD],
      [rules.FIELD_UNKNOWN_SCALAR, categories.IDENTIFIER_FIELD],
      [rules.FIELD_INVALID_INDEXED_SYNTAX, categories.IDENTIFIER_FIELD],
      [rules.FIELD_KIND_INCOMPATIBLE, categories.IDENTIFIER_FIELD],
      [rules.FIELD_INDEX_OUT_OF_NORMATIVE_RANGE, categories.IDENTIFIER_FIELD],
    ]);
    const expectedSubcode = validationRule === rules.FIELD_NOT_STRING
      ? this.SEMANTIC_VALIDATION_SUBCODE.TYPE
      : this.SEMANTIC_VALIDATION_SUBCODE.TEXT_OR_IDENTIFIER_FORMAT;
    return validationSubcode === expectedSubcode
      && ruleCategories.get(validationRule) === validationCategory
      && this.isClosedValidationPath(validationPath, validationCategory);
  }

  /**
   * Validate one path against schema-defined properties and traversal-controlled indexes.
   * @param {unknown} validationPath - Structural path candidate.
   * @param {string} validationCategory - Closed field category.
   * @returns {boolean} Whether the path is closed for the category.
   */
  static isClosedValidationPath(validationPath, validationCategory) {
    if (typeof validationPath !== "string") {
      return false;
    }
    const categories = this.VALIDATION_CATEGORY;
    const textPaths = [
      /^requirementMatches\[\d+\]\.(supportedFacets|notEvidencedFacets)\[\d+\]\.text$/u,
      /^emphasis\[\d+\]\.relevanceReason$/u,
    ];
    const evidencePath = /^(requirementMatches\[\d+\]\.supportedFacets\[\d+\]|emphasis\[\d+\]|supportedClaims\[\d+\]|cautions\[\d+\])\.evidenceRefs\[\d+\]\.(itemId|field)$/u;
    if (validationCategory === categories.TEXT) {
      return textPaths.some((pattern) => {
        return pattern.test(validationPath);
      });
    }
    const match = validationPath.match(evidencePath);
    if (match === null) {
      return false;
    }
    return validationCategory === categories.IDENTIFIER_ITEM_ID
      ? validationPath.endsWith(".itemId")
      : validationCategory === categories.IDENTIFIER_FIELD
        && validationPath.endsWith(".field");
  }
}

export { ApplicationBriefMatcherError };
