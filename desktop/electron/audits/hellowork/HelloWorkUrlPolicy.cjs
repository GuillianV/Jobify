const { HelloWorkAuditConfig } = require("./HelloWorkAuditConfig.cjs");

/**
 * Pure URL and navigation policy for the isolated HelloWork audit.
 */
class HelloWorkUrlPolicy {
  /**
   * Validate an initial, redirected or final URL.
   * @param {unknown} value - Candidate URL.
   * @returns {object} Safe validation result without path or query data.
   */
  validate(value) {
    let parsed;
    try {
      parsed = new URL(String(value));
    } catch {
      return this.rejectedMetadata(null, "INVALID_URL");
    }
    const hasCredentials = parsed.username.length > 0 || parsed.password.length > 0;
    const allowed = parsed.protocol === HelloWorkAuditConfig.ALLOWED_PROTOCOL
      && parsed.hostname === HelloWorkAuditConfig.ALLOWED_HOSTNAME
      && parsed.origin === HelloWorkAuditConfig.ALLOWED_ORIGIN
      && !hasCredentials;
    return {
      allowed,
      reason: allowed ? null : "ORIGIN_REJECTED",
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      sameOrigin: parsed.origin === HelloWorkAuditConfig.ALLOWED_ORIGIN,
      hasCredentials,
    };
  }

  /**
   * Decide a main-frame navigation and prevent it when disallowed.
   * @param {object} event - Electron-like navigation event.
   * @param {unknown} value - Navigation URL.
   * @param {boolean} isMainFrame - Whether the navigation affects the main frame.
   * @returns {object} Safe navigation decision.
   */
  guardNavigation(event, value, isMainFrame) {
    const validation = this.validate(value);
    const allowed = !isMainFrame || validation.allowed;
    if (!allowed && event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    return {
      ...validation,
      allowed,
      mainFrame: Boolean(isMainFrame),
    };
  }

  /**
   * Compare two valid URLs deterministically while ignoring their fragments.
   * @param {unknown} initialValue - Initial URL.
   * @param {unknown} finalValue - Final loaded URL.
   * @returns {boolean|null} Equality, or null when either URL is invalid or disallowed.
   */
  urlsEqualIgnoringFragment(initialValue, finalValue) {
    if (!this.validate(initialValue).allowed || !this.validate(finalValue).allowed) {
      return null;
    }
    const initialUrl = new URL(String(initialValue));
    const finalUrl = new URL(String(finalValue));
    initialUrl.hash = "";
    finalUrl.hash = "";
    return initialUrl.toString() === finalUrl.toString();
  }

  /**
   * Build safe rejected metadata when no URL could be parsed.
   * @param {URL|null} parsed - Parsed URL when available.
   * @param {string} reason - Rejection reason.
   * @returns {object} Safe validation result.
   */
  rejectedMetadata(parsed, reason) {
    return {
      allowed: false,
      reason,
      protocol: parsed?.protocol ?? null,
      hostname: parsed?.hostname ?? null,
      sameOrigin: false,
      hasCredentials: false,
    };
  }
}

module.exports = { HelloWorkUrlPolicy };
