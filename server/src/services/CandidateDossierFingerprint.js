import { createHash } from "node:crypto";
import { CandidateDossierValidator } from "./CandidateDossierValidator.js";

/**
 * Computes the deterministic SHA-256 identity of validated CandidateDossier content.
 */
class CandidateDossierFingerprint {
  /**
   * Validate and fingerprint one CandidateDossier domain or plain value.
   * @param {unknown} candidateDossier - Candidate dossier content.
   * @returns {string} Lowercase hexadecimal SHA-256 content fingerprint.
   */
  static compute(candidateDossier) {
    const plainValue = candidateDossier !== null
      && typeof candidateDossier === "object"
      && typeof candidateDossier.toJson === "function"
      ? candidateDossier.toJson()
      : candidateDossier;
    const validated = new CandidateDossierValidator().validate(plainValue);
    const serialized = this.canonicalSerialize(validated.toJson());
    return createHash("sha256")
      .update(Buffer.from(serialized, "utf8"))
      .digest("hex");
  }

  /**
   * Serialize JSON-compatible plain content with recursively sorted object keys.
   * @param {unknown} value - Canonical JSON input.
   * @returns {string} Deterministic JSON serialization.
   */
  static canonicalSerialize(value) {
    return JSON.stringify(this.canonicalize(value));
  }

  /**
   * Produce a canonical detached tree while retaining array and scalar values exactly.
   * @param {unknown} value - JSON-compatible value.
   * @returns {unknown} Canonically ordered value.
   */
  static canonicalize(value) {
    if (Array.isArray(value)) {
      return value.map((item) => {
        return this.canonicalize(item);
      });
    }
    if (value !== null && typeof value === "object") {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("Canonical serialization requires plain objects");
      }
      const canonical = {};
      for (const key of Object.keys(value).sort()) {
        canonical[key] = this.canonicalize(value[key]);
      }
      return canonical;
    }
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      return value;
    }
    throw new TypeError("Canonical serialization requires JSON-compatible dossier values");
  }
}

export { CandidateDossierFingerprint };
