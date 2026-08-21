import { HttpStatus } from "../constants/HttpStatus.js";
import { OfferPreparationError } from "../services/OfferPreparationError.js";

const CANONICAL_OFFER_ID_PATTERN = /^[1-9]\d*$/u;
const INVALID_OFFER_ID_MESSAGE = "Invalid offer id";

/**
 * Parses canonical positive offer identifiers at HTTP controller boundaries.
 */
class OfferIdParser {
  /**
   * Parse one canonical positive decimal SQLite identifier.
   * @param {unknown} rawId - Raw route identifier.
   * @returns {number} Safe positive identifier.
   */
  parse(rawId) {
    if (typeof rawId !== "string" || !CANONICAL_OFFER_ID_PATTERN.test(rawId)) {
      throw new OfferPreparationError(INVALID_OFFER_ID_MESSAGE, HttpStatus.BAD_REQUEST);
    }
    const offerId = Number(rawId);
    if (!Number.isSafeInteger(offerId) || offerId <= 0) {
      throw new OfferPreparationError(INVALID_OFFER_ID_MESSAGE, HttpStatus.BAD_REQUEST);
    }
    return offerId;
  }
}

export { OfferIdParser };
