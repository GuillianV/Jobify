import { OfferPreparationConstants } from "../constants/OfferPreparationConstants.js";

/**
 * Build the visible preparation state for one offer or an empty modal.
 * @param {number|null} offerId - Visible persisted offer identifier.
 * @returns {object} Initial preparation state.
 */
function createPreparationState(offerId = null) {
  return {
    uiStatus: OfferPreparationConstants.UI_STATUS.IDLE,
    offerId,
    evaluation: null,
    userContent: null,
    providerAcquisition: null,
    userTextDraft: "",
    error: null,
    retryKind: null,
    pendingDetail: null,
  };
}

/**
 * Validate only the renderer user-text length and non-empty UX contract.
 * @param {unknown} text - Candidate draft.
 * @returns {boolean} True when submission should be enabled.
 */
function isValidUserTextDraft(text) {
  return typeof text === "string"
    && Boolean(text.trim())
    && text.length <= OfferPreparationConstants.MAXIMUM_USER_TEXT_LENGTH;
}

/**
 * Coordinates preparation operations while isolating stale visible results.
 */
class OfferPreparationOrchestrator {
  /**
   * Create the orchestrator with HTTP, IPC and React-state adapters.
   * @param {object} dependencies - Injected operations and state adapters.
   * @param {Function} dependencies.prepareOffer - POST preparation operation.
   * @param {Function} dependencies.submitUserContent - PUT user-content operation.
   * @param {Function} dependencies.persistProviderContent - PATCH provider operation.
   * @param {Function} dependencies.acquireProviderContent - Electron acquisition operation.
   * @param {Function} dependencies.fetchDetail - Electron bridge.
   * @param {Function} dependencies.applyOffer - Apply one authoritative offer projection.
   * @param {Function} dependencies.updateState - Update visible preparation state.
   * @param {Function} dependencies.getState - Read current preparation state.
   * @param {Function} dependencies.getSelectedOfferId - Read current modal offer id.
   * @param {object} [dependencies.requestIdRef] - Monotonic visible request ref.
   * @param {object} [dependencies.inFlightRef] - Synchronous visible-operation guard.
   */
  constructor({
    prepareOffer,
    submitUserContent,
    persistProviderContent,
    acquireProviderContent,
    fetchDetail,
    applyOffer,
    updateState,
    getState,
    getSelectedOfferId,
    requestIdRef = { current: 0 },
    inFlightRef = { current: false },
  }) {
    this.prepareOfferRequest = prepareOffer;
    this.submitUserContentRequest = submitUserContent;
    this.persistProviderContentRequest = persistProviderContent;
    this.acquireProviderContentRequest = acquireProviderContent;
    this.fetchDetail = fetchDetail;
    this.applyOffer = applyOffer;
    this.updateState = updateState;
    this.getState = getState;
    this.getSelectedOfferId = getSelectedOfferId;
    this.requestIdRef = requestIdRef;
    this.inFlightRef = inFlightRef;
  }

  /**
   * Reset preparation state for a newly opened read-only offer modal.
   * @param {number} offerId - Selected persisted offer identifier.
   * @returns {void}
   */
  openOffer(offerId) {
    this.invalidateVisibleOperation();
    this.updateState(createPreparationState(offerId));
  }

  /**
   * Invalidate pending visible work and clear preparation state on modal close.
   * @returns {void}
   */
  closeOffer() {
    this.invalidateVisibleOperation();
    this.updateState(createPreparationState());
  }

  /**
   * Start one preparation flow unless the visible action is already in flight.
   * @returns {Promise<void>} Resolves after the visible or stale flow settles.
   */
  async prepare() {
    const offerId = this.getSelectedOfferId();
    const operation = this.beginVisibleOperation(offerId);
    if (!operation) {
      return;
    }
    this.updateState(() => {
      return {
        ...createPreparationState(offerId),
        uiStatus: OfferPreparationConstants.UI_STATUS.PREPARING,
      };
    });
    try {
      const envelope = await this.prepareOfferRequest(offerId);
      this.applyOffer(envelope.offre);
      if (!this.isVisibleOperation(operation)) {
        return;
      }
      await this.applyEnvelope(operation, envelope, true);
    } catch {
      this.showTechnicalError(
        operation,
        OfferPreparationConstants.UI_STATUS.ERROR,
        OfferPreparationConstants.ERROR_KIND.PREPARE,
        OfferPreparationConstants.MESSAGE.PREPARE_FAILED,
        OfferPreparationConstants.RETRY_KIND.PREPARE,
      );
    } finally {
      this.finishVisibleOperation(operation);
    }
  }

  /**
   * Update the controlled user-text draft without changing server-derived state.
   * @param {string} text - New textarea value.
   * @returns {void}
   */
  updateUserTextDraft(text) {
    this.updateState((state) => {
      return { ...state, userTextDraft: text };
    });
  }

  /**
   * Submit the current user draft once and process the returned envelope.
   * @returns {Promise<void>} Resolves after the PUT operation settles.
   */
  async submitUserText() {
    const state = this.getState();
    const offerId = this.getSelectedOfferId();
    if (state.offerId !== offerId || !isValidUserTextDraft(state.userTextDraft)) {
      return;
    }
    const operation = this.beginVisibleOperation(offerId);
    if (!operation) {
      return;
    }
    this.updateState((current) => {
      return {
        ...current,
        uiStatus: OfferPreparationConstants.UI_STATUS.PREPARING,
        error: null,
        retryKind: null,
      };
    });
    try {
      const envelope = await this.submitUserContentRequest(offerId, state.userTextDraft);
      this.applyOffer(envelope.offre);
      if (!this.isVisibleOperation(operation)) {
        return;
      }
      await this.applyEnvelope(operation, envelope, false);
    } catch {
      this.showTechnicalError(
        operation,
        OfferPreparationConstants.UI_STATUS.NEEDS_USER_TEXT,
        OfferPreparationConstants.ERROR_KIND.USER_TEXT,
        OfferPreparationConstants.MESSAGE.USER_TEXT_FAILED,
        OfferPreparationConstants.RETRY_KIND.USER_TEXT,
      );
    } finally {
      this.finishVisibleOperation(operation);
    }
  }

  /**
   * Retry the operation identified by the current visible retry contract.
   * @returns {Promise<void>} Resolves after the explicit retry settles.
   */
  async retry() {
    const state = this.getState();
    if (state.retryKind === OfferPreparationConstants.RETRY_KIND.PREPARE) {
      await this.prepare();
      return;
    }
    if (state.retryKind === OfferPreparationConstants.RETRY_KIND.PROVIDER) {
      await this.retryProvider();
      return;
    }
    if (state.retryKind === OfferPreparationConstants.RETRY_KIND.PERSIST_PROVIDER) {
      await this.retryPersistProvider();
      return;
    }
    if (state.retryKind === OfferPreparationConstants.RETRY_KIND.USER_TEXT) {
      await this.submitUserText();
    }
  }

  /**
   * Retry only Electron acquisition with the retained server instruction.
   * @returns {Promise<void>} Resolves after the explicit provider retry settles.
   */
  async retryProvider() {
    const state = this.getState();
    const offerId = this.getSelectedOfferId();
    if (state.offerId !== offerId || !state.providerAcquisition) {
      return;
    }
    const operation = this.beginVisibleOperation(offerId);
    if (!operation) {
      return;
    }
    try {
      await this.acquireAndPersist(operation, state.providerAcquisition, state.userContent);
    } finally {
      this.finishVisibleOperation(operation);
    }
  }

  /**
   * Retry only PATCH persistence with the retained in-memory provider DETAIL.
   * @returns {Promise<void>} Resolves after the explicit PATCH retry settles.
   */
  async retryPersistProvider() {
    const state = this.getState();
    const offerId = this.getSelectedOfferId();
    if (state.offerId !== offerId || !state.pendingDetail) {
      return;
    }
    const operation = this.beginVisibleOperation(offerId);
    if (!operation) {
      return;
    }
    this.showProviderLoading(operation);
    try {
      await this.persistAcquiredDetail(operation, state.pendingDetail);
    } finally {
      this.finishVisibleOperation(operation);
    }
  }

  /**
   * Apply a server status without deriving any content-sufficiency decision.
   * @param {object} operation - Current visible operation identity.
   * @param {object} envelope - Validated server envelope.
   * @param {boolean} allowAutomaticProvider - Whether this flow may acquire once.
   * @returns {Promise<void>} Resolves after any permitted provider acquisition.
   */
  async applyEnvelope(operation, envelope, allowAutomaticProvider) {
    if (envelope.prepareStatus === OfferPreparationConstants.PREPARE_STATUS.READY) {
      this.updateVisibleState(operation, {
        uiStatus: OfferPreparationConstants.UI_STATUS.READY,
        offerId: envelope.offre.id,
        evaluation: envelope.evaluation,
        userContent: envelope.userContent,
        providerAcquisition: null,
        userTextDraft: envelope.userContent?.text ?? "",
        error: null,
        retryKind: null,
        pendingDetail: null,
      });
      return;
    }
    if (envelope.prepareStatus === OfferPreparationConstants.PREPARE_STATUS.NEEDS_USER_TEXT) {
      this.showNeedsUserText(operation, envelope, null, null, null);
      return;
    }
    if (allowAutomaticProvider) {
      this.updateVisibleState(operation, {
        uiStatus: OfferPreparationConstants.UI_STATUS.ACQUIRING_PROVIDER_CONTENT,
        offerId: envelope.offre.id,
        evaluation: envelope.evaluation,
        userContent: envelope.userContent,
        providerAcquisition: envelope.providerAcquisition,
        userTextDraft: envelope.userContent?.text ?? "",
        error: null,
        retryKind: null,
        pendingDetail: null,
      });
      await this.acquireAndPersist(
        operation,
        envelope.providerAcquisition,
        envelope.userContent,
      );
      return;
    }
    this.showNeedsUserText(
      operation,
      envelope,
      null,
      OfferPreparationConstants.RETRY_KIND.PROVIDER,
      envelope.providerAcquisition,
    );
  }

  /**
   * Acquire provider content once and map absence or failure to manual fallback.
   * @param {object} operation - Current operation identity.
   * @param {object} providerAcquisition - Authoritative server instruction.
   * @param {object|null} userContent - Existing user content.
   * @returns {Promise<void>} Resolves after acquisition and optional persistence.
   */
  async acquireAndPersist(operation, providerAcquisition, userContent) {
    this.showProviderLoading(operation);
    const result = await this.acquireProviderContentRequest(
      providerAcquisition,
      this.fetchDetail,
    );
    if (result.status === OfferPreparationConstants.IPC_STATUS.ACQUIRED) {
      if (this.isVisibleOperation(operation)) {
        this.updateState((state) => {
          return { ...state, pendingDetail: result.detail };
        });
      }
      await this.persistAcquiredDetail(operation, result.detail);
      return;
    }
    if (!this.isVisibleOperation(operation)) {
      return;
    }
    const envelope = {
      offre: { id: operation.offerId },
      evaluation: this.getState().evaluation,
      userContent,
    };
    if (result.status === OfferPreparationConstants.IPC_STATUS.NOT_FOUND) {
      this.showNeedsUserText(
        operation,
        envelope,
        null,
        OfferPreparationConstants.RETRY_KIND.PROVIDER,
        providerAcquisition,
      );
      return;
    }
    this.showNeedsUserText(
      operation,
      envelope,
      {
        kind: OfferPreparationConstants.ERROR_KIND.PROVIDER,
        message: OfferPreparationConstants.MESSAGE.PROVIDER_FAILED,
      },
      OfferPreparationConstants.RETRY_KIND.PROVIDER,
      providerAcquisition,
    );
  }

  /**
   * Persist acquired DETAIL once, retaining it only when PATCH fails.
   * @param {object} operation - Current operation identity.
   * @param {object} detail - In-memory acquired DETAIL.
   * @returns {Promise<void>} Resolves after PATCH and envelope processing.
   */
  async persistAcquiredDetail(operation, detail) {
    try {
      const envelope = await this.persistProviderContentRequest(operation.offerId, detail);
      this.applyOffer(envelope.offre);
      if (!this.isVisibleOperation(operation)) {
        return;
      }
      await this.applyEnvelope(operation, envelope, false);
    } catch {
      if (!this.isVisibleOperation(operation)) {
        return;
      }
      this.updateState((state) => {
        return {
          ...state,
          uiStatus: OfferPreparationConstants.UI_STATUS.NEEDS_USER_TEXT,
          error: {
            kind: OfferPreparationConstants.ERROR_KIND.PERSIST_PROVIDER,
            message: OfferPreparationConstants.MESSAGE.PERSIST_PROVIDER_FAILED,
          },
          retryKind: OfferPreparationConstants.RETRY_KIND.PERSIST_PROVIDER,
          pendingDetail: detail,
        };
      });
    }
  }

  /**
   * Show manual text fallback while retaining server evaluation and acquisition.
   * @param {object} operation - Current operation identity.
   * @param {object} envelope - Server-derived values.
   * @param {object|null} error - Optional technical error.
   * @param {string|null} retryKind - Explicit retry operation.
   * @param {object|null} providerAcquisition - Retained provider instruction.
   * @returns {void}
   */
  showNeedsUserText(operation, envelope, error, retryKind, providerAcquisition) {
    this.updateVisibleState(operation, {
      uiStatus: OfferPreparationConstants.UI_STATUS.NEEDS_USER_TEXT,
      offerId: operation.offerId,
      evaluation: envelope.evaluation,
      userContent: envelope.userContent,
      providerAcquisition: providerAcquisition ?? null,
      userTextDraft: envelope.userContent?.text ?? "",
      error,
      retryKind,
      pendingDetail: null,
    });
  }

  /**
   * Mark the current provider operation as visibly loading.
   * @param {object} operation - Current operation identity.
   * @returns {void}
   */
  showProviderLoading(operation) {
    if (!this.isVisibleOperation(operation)) {
      return;
    }
    this.updateState((state) => {
      return {
        ...state,
        uiStatus: OfferPreparationConstants.UI_STATUS.ACQUIRING_PROVIDER_CONTENT,
        error: null,
        retryKind: null,
      };
    });
  }

  /**
   * Show one generic technical error only when its operation remains visible.
   * @param {object} operation - Current operation identity.
   * @param {string} uiStatus - Visible fallback status.
   * @param {string} kind - Stable error kind.
   * @param {string} message - Generic user-facing message.
   * @param {string} retryKind - Explicit retry operation.
   * @returns {void}
   */
  showTechnicalError(operation, uiStatus, kind, message, retryKind) {
    if (!this.isVisibleOperation(operation)) {
      return;
    }
    this.updateState((state) => {
      return {
        ...state,
        uiStatus,
        error: { kind, message },
        retryKind,
      };
    });
  }

  /**
   * Replace visible state only when request id and selected offer still match.
   * @param {object} operation - Current operation identity.
   * @param {object} state - Complete next state.
   * @returns {void}
   */
  updateVisibleState(operation, state) {
    if (this.isVisibleOperation(operation)) {
      this.updateState(state);
    }
  }

  /**
   * Start one synchronously guarded visible operation.
   * @param {number|null} offerId - Current selected offer id.
   * @returns {object|null} Operation identity or null when already busy.
   */
  beginVisibleOperation(offerId) {
    if (!Number.isSafeInteger(offerId) || offerId <= 0 || this.inFlightRef.current) {
      return null;
    }
    this.requestIdRef.current += 1;
    this.inFlightRef.current = true;
    return { requestId: this.requestIdRef.current, offerId };
  }

  /**
   * Tell whether one asynchronous result still belongs to the visible modal.
   * @param {object} operation - Operation identity.
   * @returns {boolean} True when the result may update preparation state.
   */
  isVisibleOperation(operation) {
    return operation.requestId === this.requestIdRef.current
      && operation.offerId === this.getSelectedOfferId();
  }

  /**
   * Release the synchronous guard only for the latest visible operation.
   * @param {object} operation - Completed operation identity.
   * @returns {void}
   */
  finishVisibleOperation(operation) {
    if (operation.requestId === this.requestIdRef.current) {
      this.inFlightRef.current = false;
    }
  }

  /**
   * Invalidate visible asynchronous results without cancelling background work.
   * @returns {void}
   */
  invalidateVisibleOperation() {
    this.requestIdRef.current += 1;
    this.inFlightRef.current = false;
  }
}

export {
  createPreparationState,
  isValidUserTextDraft,
  OfferPreparationOrchestrator,
};
