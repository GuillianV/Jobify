import { CoverLetterConstants } from "../constants/CoverLetterConstants.js";

/**
 * Build one visible CoverLetter lifecycle state.
 * @param {number|null} offerId - Current logical detail identifier.
 * @param {object|null} applicationBriefResult - Current atomic generation pair.
 * @returns {object} Fresh state.
 */
function createCoverLetterState(offerId = null, applicationBriefResult = null) {
  return {
    uiStatus: CoverLetterConstants.UI_STATUS.IDLE,
    offerId,
    applicationBriefResult,
    coverLetter: null,
    error: null,
  };
}

/**
 * Coordinate explicit CoverLetter requests while rejecting stale generation pairs.
 */
class CoverLetterOrchestrator {
  /**
   * Create the orchestrator from transport and visible-state adapters.
   * @param {object} dependencies - Injected dependencies.
   * @param {Function} dependencies.generateCoverLetter - POST operation.
   * @param {Function} dependencies.updateState - Visible state updater.
   * @param {Function} dependencies.getSelectedOfferId - Current offer reader.
   * @param {Function} dependencies.getApplicationBriefResult - Current pair reader.
   * @param {Function} [dependencies.onRefreshRequired] - Current refresh notification.
   * @param {object} [dependencies.requestIdRef] - Monotonic request identity.
   * @param {object} [dependencies.inFlightRef] - Synchronous duplicate guard.
   * @param {object} [dependencies.abortControllerRef] - Current request controller.
   */
  constructor({
    generateCoverLetter,
    updateState,
    getSelectedOfferId,
    getApplicationBriefResult,
    onRefreshRequired = () => {},
    requestIdRef = { current: 0 },
    inFlightRef = { current: false },
    abortControllerRef = { current: null },
  }) {
    this.generateCoverLetterRequest = generateCoverLetter;
    this.updateState = updateState;
    this.getSelectedOfferId = getSelectedOfferId;
    this.getApplicationBriefResult = getApplicationBriefResult;
    this.onRefreshRequired = onRefreshRequired;
    this.requestIdRef = requestIdRef;
    this.inFlightRef = inFlightRef;
    this.abortControllerRef = abortControllerRef;
  }

  /**
   * Generate or regenerate a letter for the exact current brief result.
   * @returns {Promise<void>} Resolves after visible or stale completion.
   */
  async generate() {
    const offerId = this.getSelectedOfferId();
    const applicationBriefResult = this.getApplicationBriefResult();
    const operation = this.beginOperation(offerId, applicationBriefResult);
    if (operation === null) {
      return;
    }
    this.updateState({
      uiStatus: CoverLetterConstants.UI_STATUS.LOADING,
      offerId,
      applicationBriefResult,
      coverLetter: null,
      error: null,
    });
    try {
      const coverLetter = await this.generateCoverLetterRequest(
        offerId,
        applicationBriefResult,
        fetch,
        operation.controller.signal,
      );
      if (this.isVisible(operation)) {
        this.updateState({
          uiStatus: CoverLetterConstants.UI_STATUS.SUCCESS,
          offerId,
          applicationBriefResult,
          coverLetter,
          error: null,
        });
      }
    } catch (error) {
      if (error?.name !== "AbortError" && this.isVisible(operation)) {
        const safeError = {
          status: Number.isInteger(error?.status) ? error.status : null,
          code: typeof error?.code === "string" ? error.code : null,
        };
        this.updateState({
          uiStatus: CoverLetterConstants.UI_STATUS.ERROR,
          offerId,
          applicationBriefResult,
          coverLetter: null,
          error: safeError,
        });
        if (safeError.code === CoverLetterConstants.REFRESH_REQUIRED_CODE) {
          this.onRefreshRequired();
        }
      }
    } finally {
      this.finishOperation(operation);
    }
  }

  /**
   * Abort pending work and reset the visible CoverLetter context.
   * @param {number|null} [offerId] - Current offer after invalidation.
   * @param {object|null} [applicationBriefResult] - Current pair after invalidation.
   * @returns {void}
   */
  invalidate(offerId = null, applicationBriefResult = null) {
    this.invalidateOperation();
    this.updateState(createCoverLetterState(offerId, applicationBriefResult));
  }

  /**
   * Stop pending work without updating React state during unmount.
   * @returns {void}
   */
  dispose() {
    this.invalidateOperation();
  }

  /**
   * Claim one synchronously guarded generation operation.
   * @param {number|null} offerId - Current selected offer.
   * @param {object|null} applicationBriefResult - Current atomic pair.
   * @returns {object|null} Operation identity or null.
   */
  beginOperation(offerId, applicationBriefResult) {
    if (!Number.isSafeInteger(offerId)
      || offerId <= 0
      || applicationBriefResult === null
      || typeof applicationBriefResult !== "object"
      || this.inFlightRef.current) {
      return null;
    }
    this.requestIdRef.current += 1;
    this.inFlightRef.current = true;
    const controller = new AbortController();
    this.abortControllerRef.current = controller;
    return {
      requestId: this.requestIdRef.current,
      offerId,
      applicationBriefResult,
      controller,
    };
  }

  /**
   * Tell whether one operation still owns the offer and generation pair.
   * @param {object} operation - Captured operation identity.
   * @returns {boolean} Whether state installation remains allowed.
   */
  isVisible(operation) {
    return operation.requestId === this.requestIdRef.current
      && operation.offerId === this.getSelectedOfferId()
      && operation.applicationBriefResult === this.getApplicationBriefResult()
      && !operation.controller.signal.aborted;
  }

  /**
   * Release resources only when they still belong to this operation.
   * @param {object} operation - Completed operation identity.
   * @returns {void}
   */
  finishOperation(operation) {
    if (operation.requestId === this.requestIdRef.current
      && operation.controller === this.abortControllerRef.current) {
      this.inFlightRef.current = false;
      this.abortControllerRef.current = null;
    }
  }

  /**
   * Abort and invalidate the current operation while preserving newer ownership.
   * @returns {void}
   */
  invalidateOperation() {
    this.requestIdRef.current += 1;
    const controller = this.abortControllerRef.current;
    this.abortControllerRef.current = null;
    this.inFlightRef.current = false;
    controller?.abort();
  }
}

export { CoverLetterOrchestrator, createCoverLetterState };
