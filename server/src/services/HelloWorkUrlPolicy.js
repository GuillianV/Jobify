import { OfferContentAcquisitionConstants } from "../constants/OfferContentAcquisitionConstants.js";

/**
 * Shared server policy for credential-free URLs on the exact HelloWork origin.
 */
class HelloWorkUrlPolicy {
  /**
   * Parse one candidate according to the authoritative server URL policy.
   * @param {unknown} value - Candidate URL.
   * @returns {URL|null} Validated URL or null when forbidden.
   */
  parse(value) {
    try {
      const parsed = new URL(value);
      if (parsed.origin !== OfferContentAcquisitionConstants.HELLOWORK_ORIGIN) {
        return null;
      }
      if (parsed.username || parsed.password) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }
}

export { HelloWorkUrlPolicy };
