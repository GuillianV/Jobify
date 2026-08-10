import { HttpStatus } from "../constants/HttpStatus.js";
import { JobSource } from "../constants/JobSource.js";
import { OfferContentAcquisition } from "../constants/OfferContentAcquisition.js";
import { OfferContentCompleteness } from "../constants/OfferContentCompleteness.js";
import { OfferContentAcquisitionConstants } from "../constants/OfferContentAcquisitionConstants.js";
import { OfferContent } from "../models/OfferContent.js";
import { OfferContentAcquisitionError } from "./OfferContentAcquisitionError.js";

/**
 * Validates and persists provider content acquired outside the server.
 */
class OfferContentAcquisitionService {
  /**
   * Create the service with its authoritative observation repository.
   * @param {import("../persistence/OfferRepository.js").OfferRepository} offerRepository - Store.
   */
  constructor(offerRepository) {
    this.offerRepository = offerRepository;
  }

  /**
   * Validate and persist a HelloWork DETAIL description for one observation.
   * @param {number} id - Internal observation identifier.
   * @param {object} rawDetail - Renderer-provided DETAIL fields.
   * @returns {import("../models/JobOffer.js").JobOffer} Enriched observation.
   */
  enrichHelloWorkDetail(id, rawDetail) {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new OfferContentAcquisitionError("Invalid offer id", HttpStatus.BAD_REQUEST);
    }
    const existing = this.offerRepository.findById(id);
    if (!existing) {
      throw new OfferContentAcquisitionError("Offer not found", HttpStatus.NOT_FOUND);
    }
    if (existing.source !== JobSource.HELLOWORK) {
      throw new OfferContentAcquisitionError(
        "Only HelloWork observations support DETAIL acquisition",
        HttpStatus.BAD_REQUEST,
      );
    }
    const description = this.validateDescription(rawDetail?.description);
    this.validateAttachment(existing.applyUrl, rawDetail?.sourceUrl);
    const incomingContent = new OfferContent({
      automaticText: {
        value: description,
        acquisition: OfferContentAcquisition.DETAIL,
        completeness: OfferContentCompleteness.PROVIDER_FULL,
        retrievedAt: new Date().toISOString(),
      },
    });
    return this.offerRepository.enrichContentById(id, incomingContent);
  }

  /**
   * Validate a useful bounded provider description.
   * @param {unknown} value - Candidate description.
   * @returns {string} Accepted description without rewriting it.
   */
  validateDescription(value) {
    if (!OfferContent.hasUsefulText(value)) {
      throw new OfferContentAcquisitionError("DETAIL description is required", HttpStatus.BAD_REQUEST);
    }
    if (value.length > OfferContentAcquisitionConstants.MAXIMUM_DETAIL_DESCRIPTION_LENGTH) {
      throw new OfferContentAcquisitionError("DETAIL description is too large", HttpStatus.BAD_REQUEST);
    }
    return value;
  }

  /**
   * Validate that the final DETAIL URL belongs to the persisted observation.
   * @param {string|null} persistedUrl - Authoritative SEARCH apply URL.
   * @param {unknown} sourceUrl - Final Electron DETAIL URL.
   * @returns {void}
   */
  validateAttachment(persistedUrl, sourceUrl) {
    const expected = this.parseHelloWorkUrl(persistedUrl);
    const received = this.parseHelloWorkUrl(sourceUrl);
    expected.hash = "";
    received.hash = "";
    if (expected.href !== received.href) {
      throw new OfferContentAcquisitionError(
        "DETAIL does not match the persisted observation",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Parse and validate one exact HelloWork HTTPS origin URL.
   * @param {unknown} value - Candidate URL.
   * @returns {URL} Validated URL.
   */
  parseHelloWorkUrl(value) {
    try {
      const parsed = new URL(value);
      if (parsed.origin !== OfferContentAcquisitionConstants.HELLOWORK_ORIGIN) {
        throw new TypeError("Unexpected origin");
      }
      if (parsed.username || parsed.password) {
        throw new TypeError("Credentials are forbidden");
      }
      return parsed;
    } catch {
      throw new OfferContentAcquisitionError("Invalid HelloWork DETAIL URL", HttpStatus.BAD_REQUEST);
    }
  }
}

export { OfferContentAcquisitionService };
