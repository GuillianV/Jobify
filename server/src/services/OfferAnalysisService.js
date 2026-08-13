import { OfferPreparationConstants } from "../constants/OfferPreparationConstants.js";
import { OfferAnalysisRepository } from "../persistence/OfferAnalysisRepository.js";
import { OfferAnalysisServiceError } from "./OfferAnalysisServiceError.js";
import { OfferAnalysisValidationError } from "./OfferAnalysisValidationError.js";

const CACHE_VALIDATION_STATUS = Object.freeze({
  FOUND: "FOUND",
  MISS: "MISS",
  CORRUPT: "CORRUPT",
  INVALID: "INVALID",
});

/**
 * Sequentially resolves one authoritative offer analysis through the persistent cache.
 */
class OfferAnalysisService {
  /**
   * Create the runtime orchestrator with deterministic collaborators.
   * @param {object} dependencies - Runtime dependencies.
   * @param {import("./OfferPreparationService.js").OfferPreparationService} dependencies.offerPreparationService - Authoritative preparation service.
   * @param {import("./OfferAnalysisInputProjector.js").OfferAnalysisInputProjector} dependencies.inputProjector - Deterministic input projector.
   * @param {typeof import("./OfferAnalysisCacheIdentity.js").OfferAnalysisCacheIdentity} dependencies.cacheIdentityBuilder - Identity builder.
   * @param {import("../persistence/OfferAnalysisRepository.js").OfferAnalysisRepository} dependencies.offerAnalysisRepository - Persistent cache.
   * @param {import("./OfferAnalyzerService.js").OfferAnalyzerService} dependencies.offerAnalyzerService - Validated analysis generator.
   * @param {import("./OfferAnalysisValidator.js").OfferAnalysisValidator} dependencies.analysisValidator - Cache payload validator.
   * @param {Function} [dependencies.now] - ISO timestamp provider.
   */
  constructor({
    offerPreparationService,
    inputProjector,
    cacheIdentityBuilder,
    offerAnalysisRepository,
    offerAnalyzerService,
    analysisValidator,
    now = () => {
      return new Date().toISOString();
    },
  }) {
    this.offerPreparationService = offerPreparationService;
    this.inputProjector = inputProjector;
    this.cacheIdentityBuilder = cacheIdentityBuilder;
    this.offerAnalysisRepository = offerAnalysisRepository;
    this.offerAnalyzerService = offerAnalyzerService;
    this.analysisValidator = analysisValidator;
    this.now = now;
    this.inFlight = new Map();
  }

  /**
   * Analyze one authoritative READY offer or reuse its validated persistent result.
   * @param {number} offerId - Internal offer identifier.
   * @returns {Promise<object>} Domain analysis with cache and analyzer provenance.
   */
  async analyze(offerId) {
    const preparation = await this.offerPreparationService.prepare(offerId);
    if (preparation.prepareStatus !== OfferPreparationConstants.STATUS.READY) {
      throw new OfferAnalysisServiceError(
        OfferAnalysisServiceError.CODE.OFFER_NOT_READY,
        { prepareStatus: preparation.prepareStatus },
      );
    }
    const projectedInput = this.inputProjector.build(preparation.offer);
    const executionMetadata = this.offerAnalyzerService.getExecutionMetadata();
    const identity = this.cacheIdentityBuilder.build({
      offerId: preparation.offer.id,
      contentFingerprint: projectedInput.contentFingerprint,
      deterministicInputFingerprint: projectedInput.deterministicInputFingerprint,
      policyVersion: executionMetadata.policyVersion,
      schemaVersion: executionMetadata.schemaVersion,
      llmProvider: executionMetadata.provider,
      model: executionMetadata.model,
      configuredMaxOutputTokens: executionMetadata.configuredMaxOutputTokens,
    });
    const cached = this.#readInitialCache(identity, projectedInput.effectiveText);
    if (cached) {
      return this.#buildResult(cached, true);
    }
    const existing = this.inFlight.get(identity.cacheKey);
    if (existing) {
      return await existing;
    }
    const request = Promise.resolve().then(() => {
      return this.#resolveMiss(identity, projectedInput);
    });
    this.inFlight.set(identity.cacheKey, request);
    try {
      return await request;
    } finally {
      if (this.inFlight.get(identity.cacheKey) === request) {
        this.inFlight.delete(identity.cacheKey);
      }
    }
  }

  /**
   * Double-check one owned miss before generating and persistently resolving it.
   * @param {object} identity - Exact cache identity.
   * @param {object} projectedInput - Exact deterministic analyzer input.
   * @returns {Promise<object>} Shared runtime result.
   */
  async #resolveMiss(identity, projectedInput) {
    const cached = this.#readInitialCache(identity, projectedInput.effectiveText);
    if (cached) {
      return this.#buildResult(cached, true);
    }
    const freshResult = await this.offerAnalyzerService
      .analyzeProjectedInput(projectedInput);
    const analyzedAt = this.now();
    const localRecord = {
      identity,
      analysisPayload: freshResult.offerAnalysis.toJson(),
      effectiveMaxOutputTokens: freshResult.analyzer.maxOutputTokens,
      analyzedAt,
    };
    this.#insert(localRecord);
    const winner = this.#resolveWinnerOnce(
      localRecord,
      projectedInput.effectiveText,
    );
    return this.#buildResult(winner, false);
  }

  /**
   * Read and validate a reusable pre-compute entry, cleaning only confirmed corruption.
   * @param {object} identity - Exact cache identity.
   * @param {string} effectiveText - Exact projected offer text.
   * @returns {object|null} Validated cache entry or null when recomputation is allowed.
   */
  #readInitialCache(identity, effectiveText) {
    const resolved = this.#readAndValidate(identity, effectiveText);
    if (resolved.status === CACHE_VALIDATION_STATUS.FOUND) {
      return resolved.entry;
    }
    if (resolved.status === CACHE_VALIDATION_STATUS.MISS) {
      return null;
    }
    this.#deleteCorrupt(identity);
    return null;
  }

  /**
   * Resolve one post-insert winner, repairing an invalid winner at most once.
   * @param {object} localRecord - Already validated local persistence candidate.
   * @param {string} effectiveText - Exact projected offer text.
   * @returns {object} Validated authoritative DB winner.
   */
  #resolveWinnerOnce(localRecord, effectiveText) {
    const { identity } = localRecord;
    const first = this.#readAndValidate(identity, effectiveText);
    if (first.status === CACHE_VALIDATION_STATUS.FOUND) {
      return first.entry;
    }
    if (first.status === CACHE_VALIDATION_STATUS.CORRUPT
      || first.status === CACHE_VALIDATION_STATUS.INVALID) {
      this.#deleteCorrupt(identity);
    }
    this.#insert(localRecord);
    const final = this.#readAndValidate(identity, effectiveText);
    if (final.status === CACHE_VALIDATION_STATUS.FOUND) {
      return final.entry;
    }
    throw this.#persistenceError();
  }

  /**
   * Read and semantically validate one entry without deciding cleanup or repair policy.
   * @param {object} identity - Exact cache identity.
   * @param {string} effectiveText - Exact projected offer text.
   * @returns {object} Context-neutral cache validation result.
   */
  #readAndValidate(identity, effectiveText) {
    const found = this.#readPersisted(identity);
    if (found.status === OfferAnalysisRepository.STATUS.MISS) {
      return { status: CACHE_VALIDATION_STATUS.MISS };
    }
    if (found.status === OfferAnalysisRepository.STATUS.CORRUPT) {
      return { status: CACHE_VALIDATION_STATUS.CORRUPT };
    }
    try {
      return {
        status: CACHE_VALIDATION_STATUS.FOUND,
        entry: {
          ...found,
          analysis: this.analysisValidator.validate(found.analysisPayload, effectiveText),
        },
      };
    } catch (error) {
      if (!(error instanceof OfferAnalysisValidationError)) {
        throw error;
      }
      return { status: CACHE_VALIDATION_STATUS.INVALID };
    }
  }

  /**
   * Read one repository entry and map technical failures to the runtime taxonomy.
   * @param {object} identity - Exact cache identity.
   * @returns {object} Closed repository result.
   */
  #readPersisted(identity) {
    try {
      return this.offerAnalysisRepository.findByCacheIdentity(identity);
    } catch (error) {
      throw this.#persistenceError(error);
    }
  }

  /**
   * Delete one confirmed corrupt entry without requiring it to still exist.
   * @param {object} identity - Exact cache identity.
   * @returns {void}
   */
  #deleteCorrupt(identity) {
    try {
      this.offerAnalysisRepository.deleteCorruptByCacheIdentity(identity);
    } catch (error) {
      throw this.#persistenceError(error);
    }
  }

  /**
   * Attempt one immutable persistent insertion.
   * @param {object} record - Complete validated cache record.
   * @returns {void}
   */
  #insert(record) {
    try {
      this.offerAnalysisRepository.insertOrIgnore(record);
    } catch (error) {
      throw this.#persistenceError(error);
    }
  }

  /**
   * Build one runtime envelope exclusively from an authoritative persisted entry.
   * @param {object} entry - Validated FOUND entry.
   * @param {boolean} cacheHit - Whether analysis generation was avoided.
   * @returns {object} Runtime analysis envelope.
   */
  #buildResult(entry, cacheHit) {
    return {
      analysis: entry.analysis,
      cacheHit,
      analyzer: {
        policyVersion: entry.identity.policyVersion,
        schemaVersion: entry.identity.schemaVersion,
        provider: entry.identity.llmProvider,
        model: entry.identity.model,
        configuredMaxOutputTokens: entry.identity.configuredMaxOutputTokens,
        effectiveMaxOutputTokens: entry.effectiveMaxOutputTokens,
      },
      analyzedAt: entry.analyzedAt,
    };
  }

  /**
   * Create one safe persistence error without exposing storage diagnostics.
   * @param {Error|null} [cause] - Internal repository or validation cause.
   * @returns {OfferAnalysisServiceError} Safe runtime error.
   */
  #persistenceError(cause = null) {
    return new OfferAnalysisServiceError(
      OfferAnalysisServiceError.CODE.CACHE_PERSISTENCE_ERROR,
      {},
      cause,
    );
  }
}

export { OfferAnalysisService };
