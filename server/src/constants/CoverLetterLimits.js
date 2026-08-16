import { ApplicationBriefLimits } from "./ApplicationBriefLimits.js";

/**
 * Structural bounds for one generated CoverLetter V1.
 */
class CoverLetterLimits {
  static MINIMUM_LETTER_LENGTH = 400;

  static MAXIMUM_LETTER_LENGTH = 3000;

  static MAXIMUM_USED_CLAIM_INDEXES = ApplicationBriefLimits.MAX_SUPPORTED_CLAIMS;

  static INTEGRITY_SECRET_BYTES = 32;

  static HMAC_SHA256_BYTES = 32;
}

export { CoverLetterLimits };
