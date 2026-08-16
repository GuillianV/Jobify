import { ApplicationBriefConstants } from "../constants/ApplicationBriefConstants.js";

/**
 * Build one visible ApplicationBrief lifecycle state.
 * @param {number|null} offerId - Current logical detail identifier.
 * @returns {object} Fresh state.
 */
function createApplicationBriefState(offerId = null) {
  return {
    uiStatus: ApplicationBriefConstants.UI_STATUS.IDLE,
    offerId,
    brief: null,
    error: null,
  };
}

/**
 * Coordinates explicit ApplicationBrief requests and rejects stale visible results.
 */
class ApplicationBriefOrchestrator {
  /**
   * Create the orchestrator with request and state adapters.
   * @param {object} dependencies - Injected dependencies.
   * @param {Function} dependencies.generateApplicationBrief - POST operation.
   * @param {Function} dependencies.updateState - Visible state updater.
   * @param {Function} dependencies.getSelectedOfferId - Current modal offer ID reader.
   * @param {object} [dependencies.requestIdRef] - Monotonic request identity.
   * @param {object} [dependencies.inFlightRef] - Synchronous duplicate guard.
   */
  constructor({
    generateApplicationBrief,
    updateState,
    getSelectedOfferId,
    requestIdRef = { current: 0 },
    inFlightRef = { current: false },
  }) {
    this.generateApplicationBriefRequest = generateApplicationBrief;
    this.updateState = updateState;
    this.getSelectedOfferId = getSelectedOfferId;
    this.requestIdRef = requestIdRef;
    this.inFlightRef = inFlightRef;
  }

  /**
   * Reset the brief lifecycle for one newly opened offer.
   * @param {number} offerId - Newly selected offer ID.
   * @returns {void}
   */
  openOffer(offerId) {
    this.invalidate(offerId);
  }

  /**
   * Invalidate every visible request and reset to a context-bound idle state.
   * @param {number|null} [offerId] - Current context after invalidation.
   * @returns {void}
   */
  invalidate(offerId = null) {
    this.requestIdRef.current += 1;
    this.inFlightRef.current = false;
    this.updateState(createApplicationBriefState(offerId));
  }

  /**
   * Start one explicit request unless another visible request is already pending.
   * @returns {Promise<void>} Resolves after visible or stale completion.
   */
  async analyze() {
    const offerId = this.getSelectedOfferId();
    const operation = this.beginOperation(offerId);
    if (operation === null) {
      return;
    }
    this.updateState({
      uiStatus: ApplicationBriefConstants.UI_STATUS.LOADING,
      offerId,
      brief: null,
      error: null,
    });
    try {
      const brief = await this.generateApplicationBriefRequest(offerId);
      if (this.isVisible(operation)) {
        this.updateState({
          uiStatus: ApplicationBriefConstants.UI_STATUS.SUCCESS,
          offerId,
          brief,
          error: null,
        });
      }
    } catch (error) {
      if (this.isVisible(operation)) {
        this.updateState({
          uiStatus: ApplicationBriefConstants.UI_STATUS.ERROR,
          offerId,
          brief: null,
          error: {
            status: Number.isInteger(error?.status) ? error.status : null,
            code: typeof error?.code === "string" ? error.code : null,
          },
        });
      }
    } finally {
      this.finishOperation(operation);
    }
  }

  /**
   * Retry through the same explicit guarded request path.
   * @returns {Promise<void>} Resolves after retry completion.
   */
  async retry() {
    await this.analyze();
  }

  /**
   * Claim one visible operation synchronously.
   * @param {number|null} offerId - Selected offer ID.
   * @returns {object|null} Operation identity or null.
   */
  beginOperation(offerId) {
    if (!Number.isSafeInteger(offerId) || offerId <= 0 || this.inFlightRef.current) {
      return null;
    }
    this.requestIdRef.current += 1;
    this.inFlightRef.current = true;
    return { requestId: this.requestIdRef.current, offerId };
  }

  /**
   * Tell whether an operation still owns the visible detail.
   * @param {object} operation - Captured request identity.
   * @returns {boolean} Whether state updates remain allowed.
   */
  isVisible(operation) {
    return operation.requestId === this.requestIdRef.current
      && operation.offerId === this.getSelectedOfferId();
  }

  /**
   * Release only the latest visible synchronous guard.
   * @param {object} operation - Completed operation identity.
   * @returns {void}
   */
  finishOperation(operation) {
    if (operation.requestId === this.requestIdRef.current) {
      this.inFlightRef.current = false;
    }
  }
}

export { ApplicationBriefOrchestrator, createApplicationBriefState };
