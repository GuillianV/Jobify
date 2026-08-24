import { ApplicationBriefConstants } from "./ApplicationBriefConstants.js";

/**
 * Builds the strict Groq response format for ApplicationBrief semantic output.
 */
class ApplicationBriefSemanticJsonSchema {
  static NAME = "application_brief_semantic_v1";

  /**
   * Build one detached strict response format from canonical structural enums.
   * @returns {object} Groq strict JSON Schema response format.
   */
  static createResponseFormat() {
    const evidenceReference = this.createEvidenceReferenceSchema();
    const offerReference = this.createOfferReferenceSchema();
    const supportedFacet = this.createSupportedFacetSchema(evidenceReference);
    const schema = {
      type: "object",
      properties: {
        requirementMatches: {
          type: "array",
          items: this.createRequirementMatchSchema(supportedFacet),
        },
        emphasis: {
          type: "array",
          items: this.createEmphasisSchema(offerReference, evidenceReference),
        },
        supportedClaims: {
          type: "array",
          items: this.createSupportedClaimSchema(offerReference, evidenceReference),
        },
        cautions: {
          type: "array",
          items: this.createCautionSchema(offerReference, evidenceReference),
        },
      },
      required: ["requirementMatches", "emphasis", "supportedClaims", "cautions"],
      additionalProperties: false,
    };
    return {
      type: "json_schema",
      json_schema: {
        name: ApplicationBriefSemanticJsonSchema.NAME,
        strict: true,
        schema,
      },
    };
  }

  /**
   * Build the requirement-specific semantic match shape.
   * @param {object} supportedFacet - Closed supported facet schema.
   * @returns {object} Closed requirement match schema.
   */
  static createRequirementMatchSchema(supportedFacet) {
    const requirementKind = ApplicationBriefConstants.OFFER_REF_KIND.REQUIREMENT;
    return {
      type: "object",
      properties: {
        offerRef: {
          type: "object",
          properties: {
            kind: { type: "string", enum: [requirementKind] },
            index: { type: "integer" },
          },
          required: ["kind", "index"],
          additionalProperties: false,
        },
        state: {
          type: "string",
          enum: Object.values(ApplicationBriefConstants.EVIDENCE_STATE),
        },
        supportedFacets: {
          type: "array",
          items: supportedFacet,
        },
        notEvidencedFacets: {
          type: "array",
          items: this.createNotEvidencedFacetSchema(),
        },
      },
      required: ["offerRef", "state", "supportedFacets", "notEvidencedFacets"],
      additionalProperties: false,
    };
  }

  /**
   * Build one supported facet shape.
   * @param {object} evidenceReference - Closed evidence reference schema.
   * @returns {object} Closed supported facet schema.
   */
  static createSupportedFacetSchema(evidenceReference) {
    return {
      type: "object",
      properties: {
        text: { type: "string" },
        evidenceRefs: { type: "array", items: evidenceReference },
      },
      required: ["text", "evidenceRefs"],
      additionalProperties: false,
    };
  }

  /**
   * Build one unsupported facet shape without candidate assertions.
   * @returns {object} Closed not-evidenced facet schema.
   */
  static createNotEvidencedFacetSchema() {
    return {
      type: "object",
      properties: {
        text: { type: "string" },
      },
      required: ["text"],
      additionalProperties: false,
    };
  }

  /**
   * Build one emphasis shape.
   * @param {object} offerReference - Closed offer reference union.
   * @param {object} evidenceReference - Closed evidence reference schema.
   * @returns {object} Closed emphasis schema.
   */
  static createEmphasisSchema(offerReference, evidenceReference) {
    return {
      type: "object",
      properties: {
        priority: {
          type: "string",
          enum: Object.values(ApplicationBriefConstants.PRIORITY),
        },
        offerRefs: { type: "array", items: offerReference },
        evidenceRefs: { type: "array", items: evidenceReference },
        relevanceReason: { type: "string" },
      },
      required: ["priority", "offerRefs", "evidenceRefs", "relevanceReason"],
      additionalProperties: false,
    };
  }

  /**
   * Build one structured supported claim shape.
   * @param {object} offerReference - Closed offer reference union.
   * @param {object} evidenceReference - Closed evidence reference schema.
   * @returns {object} Closed supported claim schema.
   */
  static createSupportedClaimSchema(offerReference, evidenceReference) {
    return {
      type: "object",
      properties: {
        claimType: {
          type: "string",
          enum: Object.values(ApplicationBriefConstants.CLAIM_TYPE),
        },
        offerRefs: { type: "array", items: offerReference },
        evidenceRefs: { type: "array", items: evidenceReference },
      },
      required: ["claimType", "offerRefs", "evidenceRefs"],
      additionalProperties: false,
    };
  }

  /**
   * Build one closed overclaim caution shape.
   * @param {object} offerReference - Closed offer reference union.
   * @param {object} evidenceReference - Closed evidence reference schema.
   * @returns {object} Closed caution schema.
   */
  static createCautionSchema(offerReference, evidenceReference) {
    return {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: Object.values(ApplicationBriefConstants.CAUTION_KIND),
        },
        offerRefs: { type: "array", items: offerReference },
        evidenceRefs: { type: "array", items: evidenceReference },
      },
      required: ["kind", "offerRefs", "evidenceRefs"],
      additionalProperties: false,
    };
  }

  /**
   * Build the indexed and seniority offer reference union.
   * @returns {object} Closed offer reference union schema.
   */
  static createOfferReferenceSchema() {
    const kinds = ApplicationBriefConstants.OFFER_REF_KIND;
    return {
      anyOf: [
        {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: [kinds.REQUIREMENT, kinds.ACTIVITY, kinds.CONTEXT],
            },
            index: { type: "integer" },
          },
          required: ["kind", "index"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { type: "string", enum: [kinds.SENIORITY] },
          },
          required: ["kind"],
          additionalProperties: false,
        },
      ],
    };
  }

  /**
   * Build one structural candidate evidence reference shape.
   * @returns {object} Closed evidence reference schema.
   */
  static createEvidenceReferenceSchema() {
    return {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: Object.values(ApplicationBriefConstants.EVIDENCE_KIND),
        },
        itemId: { type: "string" },
        field: { type: "string" },
      },
      required: ["kind", "itemId", "field"],
      additionalProperties: false,
    };
  }
}

export { ApplicationBriefSemanticJsonSchema };
