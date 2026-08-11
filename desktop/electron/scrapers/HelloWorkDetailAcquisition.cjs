const {
  HelloWorkDetailAcquisitionConstants,
} = require("./HelloWorkDetailAcquisitionConstants.cjs");

/**
 * Maps one validated provider instruction to a safe public Electron result.
 */
class HelloWorkDetailAcquisition {
  /**
   * Create the adapter with the secured scraper and its shared URL policy.
   * @param {import("./HelloWorkScraper.cjs").HelloWorkScraper} scraper - Secured scraper.
   * @param {import("./HelloWorkUrlPolicy.cjs").HelloWorkUrlPolicy} urlPolicy - URL policy.
   * @param {object} [logger] - Main-process technical logger.
   */
  constructor(scraper, urlPolicy, logger = console) {
    this.scraper = scraper;
    this.urlPolicy = urlPolicy;
    this.logger = logger;
  }

  /**
   * Acquire one provider DETAIL and return only the discriminated public contract.
   * @param {unknown} instruction - Server-provided acquisition instruction.
   * @returns {Promise<object>} ACQUIRED, NOT_FOUND or FAILED result.
   */
  async acquire(instruction) {
    if (!this.isAllowedInstruction(instruction)) {
      return this.failedResult();
    }
    try {
      const detail = await this.scraper.fetchDetail(instruction.url);
      if (!this.isUsableDetail(detail)) {
        return { status: HelloWorkDetailAcquisitionConstants.STATUS.NOT_FOUND };
      }
      return {
        status: HelloWorkDetailAcquisitionConstants.STATUS.ACQUIRED,
        detail: {
          description: detail.description,
          sourceUrl: detail.sourceUrl,
        },
      };
    } catch (error) {
      this.logger.warn(`Offer detail fetch failed: ${error.message}`);
      return this.failedResult();
    }
  }

  /**
   * Validate the supported instruction and its exact HelloWork URL policy.
   * @param {unknown} instruction - Candidate provider instruction.
   * @returns {boolean} True when the secured scraper may be called.
   */
  isAllowedInstruction(instruction) {
    return Boolean(instruction)
      && typeof instruction === "object"
      && !Array.isArray(instruction)
      && instruction.kind === HelloWorkDetailAcquisitionConstants.KIND
      && instruction.source === HelloWorkDetailAcquisitionConstants.SOURCE
      && this.urlPolicy.isAllowed(instruction.url);
  }

  /**
   * Validate the minimal DETAIL fields exposed to the renderer.
   * @param {unknown} detail - Internal scraper result.
   * @returns {boolean} True when the public DETAIL is useful and policy-compliant.
   */
  isUsableDetail(detail) {
    return Boolean(detail)
      && typeof detail === "object"
      && !Array.isArray(detail)
      && typeof detail.description === "string"
      && Boolean(detail.description.trim())
      && typeof detail.sourceUrl === "string"
      && this.urlPolicy.isAllowed(detail.sourceUrl);
  }

  /**
   * Build the exact failure contract without exception details.
   * @returns {{status: string}} Safe public failure.
   */
  failedResult() {
    return { status: HelloWorkDetailAcquisitionConstants.STATUS.FAILED };
  }
}

module.exports = { HelloWorkDetailAcquisition };
