import { HttpStatus } from "../constants/HttpStatus.js";
import { JobSource } from "../constants/JobSource.js";
import { OfferContentAcquisition } from "../constants/OfferContentAcquisition.js";
import { OfferContentEvaluationConstants } from "../constants/OfferContentEvaluationConstants.js";
import { OfferContentLimits } from "../constants/OfferContentLimits.js";
import { OfferPreparationConstants } from "../constants/OfferPreparationConstants.js";
import { OfferPreparationError } from "./OfferPreparationError.js";

/**
 * Orchestrates the read-only preparation decision and explicit user-text replacement.
 */
class OfferPreparationService {
  /**
   * Create the service with authoritative persistence and deterministic policies.
   * @param {import("../persistence/OfferRepository.js").OfferRepository} offerRepository - Store.
   * @param {import("./OfferContentEvaluator.js").OfferContentEvaluator} evaluator - Evaluator.
   * @param {import("./HelloWorkUrlPolicy.js").HelloWorkUrlPolicy} helloWorkUrlPolicy - URL policy.
   * @param {Function} now - Server timestamp provider.
   */
  constructor(offerRepository, evaluator, helloWorkUrlPolicy, now) {
    this.offerRepository = offerRepository;
    this.evaluator = evaluator;
    this.helloWorkUrlPolicy = helloWorkUrlPolicy;
    this.now = now;
  }

  /**
   * Reload and evaluate one authoritative persisted observation without writing.
   * @param {number} id - Internal SQLite identifier.
   * @returns {object} Preparation result containing the authoritative offer.
   */
  prepare(id) {
    this.validateId(id);
    const offer = this.offerRepository.findById(id);
    if (!offer) {
      throw new OfferPreparationError("Offer not found", HttpStatus.NOT_FOUND);
    }
    return this.buildPreparation(offer);
  }

  /**
   * Validate, explicitly persist and immediately reevaluate user-provided text.
   * @param {number} id - Internal SQLite identifier.
   * @param {unknown} text - Candidate user text.
   * @returns {object} Preparation result after persistence or an exact no-op.
   */
  replaceUserText(id, text) {
    this.validateId(id);
    this.validateUserText(text);
    const existing = this.offerRepository.findById(id);
    if (!existing) {
      throw new OfferPreparationError("Offer not found", HttpStatus.NOT_FOUND);
    }
    if (existing.offerContent.userText?.value === text) {
      return this.buildPreparation(existing);
    }
    const updated = this.offerRepository.replaceUserTextById(id, text, this.now());
    if (!updated) {
      throw new OfferPreparationError("Offer not found", HttpStatus.NOT_FOUND);
    }
    return this.buildPreparation(updated);
  }

  /**
   * Build a preparation decision for an authoritative hydrated observation.
   * @param {import("../models/JobOffer.js").JobOffer} offer - Persisted observation.
   * @returns {object} Internal preparation result for API projection.
   */
  buildPreparation(offer) {
    const evaluation = this.evaluator.evaluate(offer.offerContent);
    const providerAcquisition = this.resolveProviderAcquisition(offer, evaluation);
    return {
      prepareStatus: this.resolveStatus(evaluation, providerAcquisition),
      evaluation,
      offer,
      userContent: offer.offerContent.userText
        ? {
          text: offer.offerContent.userText.value,
          providedAt: offer.offerContent.userText.providedAt,
        }
        : null,
      providerAcquisition,
    };
  }

  /**
   * Resolve the public preparation status from evaluation and acquisition eligibility.
   * @param {object} evaluation - Deterministic content evaluation.
   * @param {object|null} providerAcquisition - Available provider instruction.
   * @returns {string} One stable preparation status.
   */
  resolveStatus(evaluation, providerAcquisition) {
    if (evaluation.status === OfferContentEvaluationConstants.STATUS.SUFFICIENT) {
      return OfferPreparationConstants.STATUS.READY;
    }
    if (providerAcquisition) {
      return OfferPreparationConstants.STATUS.NEEDS_PROVIDER_ACQUISITION;
    }
    return OfferPreparationConstants.STATUS.NEEDS_USER_TEXT;
  }

  /**
   * Build an authoritative HelloWork DETAIL instruction when it can still help.
   * @param {import("../models/JobOffer.js").JobOffer} offer - Persisted observation.
   * @param {object} evaluation - Deterministic content evaluation.
   * @returns {object|null} Provider instruction or null when unavailable or pointless.
   */
  resolveProviderAcquisition(offer, evaluation) {
    if (evaluation.status === OfferContentEvaluationConstants.STATUS.SUFFICIENT) {
      return null;
    }
    if (offer.source !== JobSource.HELLOWORK || offer.offerContent.userText) {
      return null;
    }
    if (offer.offerContent.automaticText?.acquisition === OfferContentAcquisition.DETAIL) {
      return null;
    }
    const validatedUrl = this.helloWorkUrlPolicy.parse(offer.applyUrl);
    if (!validatedUrl) {
      return null;
    }
    return {
      kind: OfferPreparationConstants.PROVIDER_ACQUISITION_KIND.HELLOWORK_DETAIL,
      source: JobSource.HELLOWORK,
      url: offer.applyUrl,
    };
  }

  /**
   * Validate one internal observation identifier.
   * @param {number} id - Candidate identifier.
   * @returns {void}
   */
  validateId(id) {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new OfferPreparationError("Invalid offer id", HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * Validate user text without rewriting the value that will be stored.
   * @param {unknown} text - Candidate user text.
   * @returns {void}
   */
  validateUserText(text) {
    if (typeof text !== "string" || !text.trim()) {
      throw new OfferPreparationError("User content text is required", HttpStatus.BAD_REQUEST);
    }
    if (text.length > OfferContentLimits.MAXIMUM_TEXT_LENGTH) {
      throw new OfferPreparationError("User content text is too large", HttpStatus.BAD_REQUEST);
    }
  }
}

export { OfferPreparationService };
