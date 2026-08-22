import { OfferAnalysisConstants } from "./OfferAnalysisConstants.js";

/**
 * Builds the strict Groq response format for the structural OfferAnalysis contract.
 */
class OfferAnalysisJsonSchema {
  static NAME = "offer_analysis_v1";

  /**
   * Build one detached strict response format from canonical structural enums.
   * @returns {object} Groq strict JSON Schema response format.
   */
  static createResponseFormat() {
    const evidence = {
      type: "object",
      properties: {
        text: {
          type: "string",
        },
      },
      required: ["text"],
      additionalProperties: false,
    };
    const nullableEvidence = {
      anyOf: [evidence, { type: "null" }],
    };
    const assertion = {
      type: "string",
      enum: Object.values(OfferAnalysisConstants.ASSERTION),
    };
    const explicitAssertion = {
      type: "string",
      enum: [OfferAnalysisConstants.ASSERTION.EXPLICIT],
    };
    const value = {
      type: "string",
    };
    const schema = {
      type: "object",
      properties: {
        seniority: {
          anyOf: [
            {
              type: "object",
              properties: {
                levels: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: Object.values(OfferAnalysisConstants.SENIORITY_LEVEL),
                  },
                },
                assertion,
                evidence: nullableEvidence,
              },
              required: ["levels", "assertion", "evidence"],
              additionalProperties: false,
            },
            { type: "null" },
          ],
        },
        activities: {
          type: "array",
          items: {
            type: "object",
            properties: {
              value,
              assertion,
              evidence: nullableEvidence,
            },
            required: ["value", "assertion", "evidence"],
            additionalProperties: false,
          },
        },
        requirements: {
          type: "array",
          items: {
            type: "object",
            properties: {
              category: {
                type: "string",
                enum: Object.values(OfferAnalysisConstants.REQUIREMENT_CATEGORY),
              },
              value,
              importance: {
                type: "string",
                enum: Object.values(OfferAnalysisConstants.REQUIREMENT_IMPORTANCE),
              },
              assertion: explicitAssertion,
              evidence,
            },
            required: ["category", "value", "importance", "assertion", "evidence"],
            additionalProperties: false,
          },
        },
        context: {
          type: "array",
          items: {
            type: "object",
            properties: {
              category: {
                type: "string",
                enum: Object.values(OfferAnalysisConstants.CONTEXT_CATEGORY),
              },
              value,
              assertion,
              evidence: nullableEvidence,
            },
            required: ["category", "value", "assertion", "evidence"],
            additionalProperties: false,
          },
        },
        workConditions: {
          type: "object",
          properties: {
            workMode: {
              anyOf: [
                {
                  type: "object",
                  properties: {
                    mode: {
                      type: "string",
                      enum: Object.values(OfferAnalysisConstants.WORK_MODE),
                    },
                    detail: {
                      anyOf: [
                        {
                          type: "string",
                        },
                        { type: "null" },
                      ],
                    },
                    assertion: explicitAssertion,
                    evidence,
                  },
                  required: ["mode", "detail", "assertion", "evidence"],
                  additionalProperties: false,
                },
                { type: "null" },
              ],
            },
            constraints: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: {
                    type: "string",
                    enum: Object.values(OfferAnalysisConstants.CONSTRAINT_CATEGORY),
                  },
                  value,
                  assertion: explicitAssertion,
                  evidence,
                },
                required: ["category", "value", "assertion", "evidence"],
                additionalProperties: false,
              },
            },
          },
          required: ["workMode", "constraints"],
          additionalProperties: false,
        },
      },
      required: ["seniority", "activities", "requirements", "context", "workConditions"],
      additionalProperties: false,
    };
    return {
      type: "json_schema",
      json_schema: {
        name: OfferAnalysisJsonSchema.NAME,
        strict: true,
        schema,
      },
    };
  }
}

export { OfferAnalysisJsonSchema };
