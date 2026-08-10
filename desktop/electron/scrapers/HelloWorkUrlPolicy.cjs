const { HelloWorkConfig } = require("./HelloWorkConfig.cjs");

/**
 * Validates HelloWork URLs used by the hidden DETAIL browser window.
 */
class HelloWorkUrlPolicy {
  /**
   * Tell whether a candidate uses the exact credential-free HelloWork HTTPS origin.
   * @param {unknown} value - Candidate URL.
   * @returns {boolean} True when the URL is allowed.
   */
  isAllowed(value) {
    try {
      const parsed = new URL(String(value));
      return parsed.protocol === HelloWorkConfig.ALLOWED_PROTOCOL
        && parsed.origin === HelloWorkConfig.ALLOWED_ORIGIN
        && !parsed.username
        && !parsed.password;
    } catch {
      return false;
    }
  }

  /**
   * Prevent a main-frame navigation when its target is not allowed.
   * @param {object} event - Electron navigation event.
   * @param {unknown} value - Navigation target.
   * @param {boolean} [isMainFrame] - Whether the navigation affects the main frame.
   * @returns {boolean} True when navigation remains allowed.
   */
  guardNavigation(event, value, isMainFrame = true) {
    const allowed = !isMainFrame || this.isAllowed(value);
    if (!allowed && event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    return allowed;
  }
}

module.exports = { HelloWorkUrlPolicy };
