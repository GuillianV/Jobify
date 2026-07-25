/**
 * Base class every job source connector extends. It defines the contract used
 * by the search service: report the source, whether it is usable, and run a
 * search returning canonical offers.
 */
class JobConnector {
  /**
   * Return the source identifier the connector produces (see JobSource).
   * @returns {string} The source identifier.
   */
  getSource() {
    throw new Error("getSource() must be implemented by a subclass.");
  }

  /**
   * Tell whether the connector has everything it needs to run (credentials).
   * @returns {boolean} True when the connector can be queried.
   */
  isConfigured() {
    return true;
  }

  /**
   * Run a search and return canonical offers.
   * @returns {Promise<import("../models/JobOffer.js").JobOffer[]>} The offers.
   */
  async search() {
    throw new Error("search() must be implemented by a subclass.");
  }
}

export { JobConnector };
