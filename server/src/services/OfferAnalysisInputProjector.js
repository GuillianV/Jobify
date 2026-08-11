import { createHash } from "node:crypto";
import { OfferAnalysisConstants } from "../constants/OfferAnalysisConstants.js";
import { JobOffer } from "../models/JobOffer.js";

/**
 * Builds the exact deterministic input for future offer analysis.
 */
class OfferAnalysisInputProjector {
  /**
   * Project one hydrated JobOffer and its authoritative effective text.
   * @param {JobOffer} offer - Hydrated provider observation.
   * @returns {object} Snapshot, effective content and exact fingerprints.
   */
  build(offer) {
    if (!(offer instanceof JobOffer)) {
      throw new TypeError("OfferAnalysisInputProjector requires a JobOffer");
    }
    const effectiveText = offer.offerContent.getEffectiveText();
    if (typeof effectiveText !== "string" || !effectiveText) {
      throw new Error("Offer analysis requires effective text");
    }
    const offerSnapshot = this.buildOfferSnapshot(offer);
    return {
      offerSnapshot,
      effectiveText,
      effectiveContentOrigin: offer.offerContent.userText
        ? OfferAnalysisConstants.EFFECTIVE_CONTENT_ORIGIN.USER
        : OfferAnalysisConstants.EFFECTIVE_CONTENT_ORIGIN.AUTOMATIC,
      contentFingerprint: this.hash(effectiveText),
      deterministicInputFingerprint: this.hash(this.canonicalSerialize(offerSnapshot)),
    };
  }

  /**
   * Build the bounded deterministic snapshot used by future analysis.
   * @param {JobOffer} offer - Hydrated provider observation.
   * @returns {object} Canonical snapshot without content or application data.
   */
  buildOfferSnapshot(offer) {
    const companyName = offer.company?.name ?? null;
    return {
      offerId: offer.id,
      source: offer.source,
      title: offer.title,
      company: companyName === null ? null : { name: companyName },
      location: {
        label: offer.location?.label ?? null,
        city: offer.location?.city ?? null,
        postalCode: offer.location?.postalCode ?? null,
        country: offer.location?.country ?? null,
      },
      contract: {
        type: offer.contractType ?? null,
        label: offer.contractTypeLabel ?? null,
      },
      salary: {
        min: this.normalizeFiniteNumber(offer.salary?.min),
        max: this.normalizeFiniteNumber(offer.salary?.max),
        currency: offer.salary?.currency ?? null,
        period: offer.salary?.period ?? null,
        raw: offer.salary?.raw ?? null,
      },
    };
  }

  /**
   * Serialize JSON-compatible data with recursively sorted object keys.
   * @param {unknown} value - JSON-compatible value without undefined fields.
   * @returns {string} Canonical JSON serialization.
   */
  canonicalSerialize(value) {
    return JSON.stringify(this.canonicalize(value));
  }

  /**
   * Recursively sort object keys while preserving array order and null values.
   * @param {unknown} value - JSON-compatible value.
   * @returns {unknown} Canonically ordered value.
   */
  canonicalize(value) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("Canonical serialization requires finite numbers");
    }
    if (Array.isArray(value)) {
      return value.map((item) => {
        return this.canonicalize(item);
      });
    }
    if (value !== null && typeof value === "object") {
      const ordered = {};
      const keys = Object.keys(value).sort();
      for (const key of keys) {
        if (value[key] !== undefined) {
          ordered[key] = this.canonicalize(value[key]);
        }
      }
      return ordered;
    }
    return value;
  }

  /**
   * Preserve finite salary amounts and map every absent or non-finite value to null.
   * @param {unknown} value - Existing salary amount.
   * @returns {number|null} JSON-safe salary amount.
   */
  normalizeFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  /**
   * Hash an exact UTF-8 string with SHA-256.
   * @param {string} value - Exact value to hash.
   * @returns {string} Lowercase hexadecimal digest.
   */
  hash(value) {
    return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
  }
}

export { OfferAnalysisInputProjector };
