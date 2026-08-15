import { ApplicationBriefConstants } from "../constants/ApplicationBriefConstants.js";
import { ApplicationBriefContextValidationError } from "./ApplicationBriefContextValidationError.js";

/**
 * Resolves structurally valid offer references against one authoritative OfferAnalysis.
 */
class ApplicationBriefOfferRefResolver {
  /**
   * Resolve one offer reference to a detached exact OfferAnalysis fact.
   * @param {import("../models/OfferAnalysis.js").OfferAnalysis} offerAnalysis - Authoritative analysis.
   * @param {object} reference - Structurally valid offer reference.
   * @returns {object} Detached referenced fact.
   */
  resolve(offerAnalysis, reference) {
    const kinds = ApplicationBriefConstants.OFFER_REF_KIND;
    if (reference.kind === kinds.SENIORITY) {
      if (offerAnalysis.seniority === null) {
        this.fail();
      }
      return structuredClone(offerAnalysis.seniority);
    }
    const collectionByKind = {
      [kinds.REQUIREMENT]: offerAnalysis.requirements,
      [kinds.ACTIVITY]: offerAnalysis.activities,
      [kinds.CONTEXT]: offerAnalysis.context,
    };
    const collection = collectionByKind[reference.kind];
    if (!Array.isArray(collection) || reference.index >= collection.length) {
      this.fail();
    }
    return structuredClone(collection[reference.index]);
  }

  /**
   * Throw the closed invalid-offer-reference failure.
   * @returns {never}
   */
  fail() {
    throw new ApplicationBriefContextValidationError(
      ApplicationBriefContextValidationError.REASON.INVALID_OFFER_REFERENCE,
    );
  }
}

export { ApplicationBriefOfferRefResolver };
