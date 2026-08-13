import { createHash } from "node:crypto";

/**
 * Builds the immutable deterministic identity of one offer-analysis cache entry.
 */
class OfferAnalysisCacheIdentity {
  /**
   * Validate and build one identity known entirely before provider execution.
   * @param {object} components - Deterministic cache identity components.
   * @returns {Readonly<object>} Immutable identity including its SHA-256 cache key.
   */
  static build(components) {
    if (!components || typeof components !== "object" || Array.isArray(components)) {
      throw new TypeError("Offer analysis cache identity components are required");
    }
    const {
      offerId,
      contentFingerprint,
      deterministicInputFingerprint,
      policyVersion,
      schemaVersion,
      llmProvider,
      model,
      configuredMaxOutputTokens,
    } = components;
    this.requirePositiveInteger(offerId, "offerId");
    this.requireNonEmptyString(contentFingerprint, "contentFingerprint");
    this.requireNonEmptyString(
      deterministicInputFingerprint,
      "deterministicInputFingerprint",
    );
    this.requireNonEmptyString(policyVersion, "policyVersion");
    this.requireNonEmptyString(schemaVersion, "schemaVersion");
    this.requireNonEmptyString(llmProvider, "llmProvider");
    this.requireNonEmptyString(model, "model");
    this.requirePositiveInteger(configuredMaxOutputTokens, "configuredMaxOutputTokens");
    const deterministicComponents = {
      offerId,
      contentFingerprint,
      deterministicInputFingerprint,
      policyVersion,
      schemaVersion,
      llmProvider,
      model,
      configuredMaxOutputTokens,
    };
    const serialized = JSON.stringify(deterministicComponents);
    const cacheKey = createHash("sha256")
      .update(Buffer.from(serialized, "utf8"))
      .digest("hex");
    return Object.freeze({ cacheKey, ...deterministicComponents });
  }

  /**
   * Require one non-empty configuration or fingerprint string without rewriting it.
   * @param {unknown} value - Candidate string.
   * @param {string} field - Field name used in the controlled error.
   * @returns {void}
   */
  static requireNonEmptyString(value, field) {
    if (typeof value !== "string" || !value.trim()) {
      throw new TypeError(`Offer analysis cache identity ${field} must be non-empty`);
    }
  }

  /**
   * Require one positive safe integer identity component.
   * @param {unknown} value - Candidate number.
   * @param {string} field - Field name used in the controlled error.
   * @returns {void}
   */
  static requirePositiveInteger(value, field) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`Offer analysis cache identity ${field} must be a positive integer`);
    }
  }
}

export { OfferAnalysisCacheIdentity };
