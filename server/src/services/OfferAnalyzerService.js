import { OfferAnalyzerConstants } from "../constants/OfferAnalyzerConstants.js";
import { OfferContentEvaluationConstants } from "../constants/OfferContentEvaluationConstants.js";
import { GroqJsonClientError } from "./GroqJsonClientError.js";
import { OfferAnalysisValidationError } from "./OfferAnalysisValidationError.js";
import { OfferAnalyzerError } from "./OfferAnalyzerError.js";

/**
 * Authoritatively analyzes one persisted READY offer into an in-memory result.
 */
class OfferAnalyzerService {
  /**
   * Create the service with every orchestration dependency injected.
   * @param {object} dependencies - Analyzer dependencies and execution policy.
   * @param {import("../persistence/OfferRepository.js").OfferRepository} dependencies.offerRepository - Authoritative store.
   * @param {import("./OfferContentEvaluator.js").OfferContentEvaluator} dependencies.offerContentEvaluator - Sufficiency evaluator.
   * @param {import("./OfferAnalysisInputProjector.js").OfferAnalysisInputProjector} dependencies.inputProjector - Deterministic projector.
   * @param {import("./OfferAnalyzerPrompt.js").OfferAnalyzerPrompt} dependencies.promptBuilder - Prompt builder.
   * @param {import("./GroqJsonClient.js").GroqJsonClient} dependencies.groqClient - JSON transport.
   * @param {import("./OfferAnalysisValidator.js").OfferAnalysisValidator} dependencies.analysisValidator - Output validator.
   * @param {object} dependencies.config - Analyzer execution config.
   */
  constructor({
    offerRepository,
    offerContentEvaluator,
    inputProjector,
    promptBuilder,
    groqClient,
    analysisValidator,
    config,
  }) {
    this.offerRepository = offerRepository;
    this.offerContentEvaluator = offerContentEvaluator;
    this.inputProjector = inputProjector;
    this.promptBuilder = promptBuilder;
    this.groqClient = groqClient;
    this.analysisValidator = analysisValidator;
    this.config = config;
  }

  /**
   * Reload, verify and analyze with at most one technical token-budget retry.
   * @param {number} id - Internal SQLite offer identifier.
   * @returns {Promise<object>} Validated in-memory analysis and deterministic provenance.
   */
  async analyze(id) {
    this.validateId(id);
    const offer = this.offerRepository.findById(id);
    if (!offer) {
      throw new OfferAnalyzerError(OfferAnalyzerError.CODE.OFFER_NOT_FOUND);
    }
    const evaluation = this.offerContentEvaluator.evaluate(offer.offerContent);
    if (evaluation.status !== OfferContentEvaluationConstants.STATUS.SUFFICIENT) {
      throw new OfferAnalyzerError(
        OfferAnalyzerError.CODE.OFFER_NOT_READY,
        {
          evaluationStatus: evaluation.status,
          evaluationPolicyVersion: evaluation.policyVersion,
        },
      );
    }
    const input = this.inputProjector.build(offer);
    if (input.effectiveText.length > this.config.maxInputLength) {
      throw new OfferAnalyzerError(OfferAnalyzerError.CODE.ANALYZER_INPUT_TOO_LARGE);
    }
    const prompts = this.promptBuilder.build(input.offerSnapshot, input.effectiveText);
    const completion = await this.requestAnalysis(prompts);
    const rawAnalysis = completion.rawAnalysis;
    let offerAnalysis;
    try {
      offerAnalysis = this.analysisValidator.validate(rawAnalysis, input.effectiveText);
    } catch (error) {
      if (!(error instanceof OfferAnalysisValidationError)) {
        throw error;
      }
      const safeDetails = { validationCode: error.validationCode };
      if (error.validationCode === OfferAnalysisValidationError.CODE.EVIDENCE
        && Object.values(OfferAnalysisValidationError.EVIDENCE_SUBCODE)
          .includes(error.validationSubcode)) {
        safeDetails.validationSubcode = error.validationSubcode;
      }
      if (error.validationCode === OfferAnalysisValidationError.CODE.ENUM
        && Object.values(OfferAnalysisValidationError.ENUM_SUBCODE)
          .includes(error.validationSubcode)) {
        safeDetails.validationSubcode = error.validationSubcode;
      }
      throw new OfferAnalyzerError(
        OfferAnalyzerError.CODE.ANALYZER_INVALID_OUTPUT,
        safeDetails,
        error,
      );
    }
    return {
      offerAnalysis,
      offerSnapshot: input.offerSnapshot,
      effectiveContentOrigin: input.effectiveContentOrigin,
      contentFingerprint: input.contentFingerprint,
      deterministicInputFingerprint: input.deterministicInputFingerprint,
      analyzer: {
        policyVersion: this.config.policyVersion,
        provider: this.config.provider,
        model: this.config.model,
        maxOutputTokens: completion.maxOutputTokens,
      },
    };
  }

  /**
   * Validate one internal numeric offer identifier.
   * @param {number} id - Identifier candidate.
   * @returns {void}
   */
  validateId(id) {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new OfferAnalyzerError(OfferAnalyzerError.CODE.INVALID_OFFER_ID);
    }
  }

  /**
   * Perform the bounded Groq attempt sequence and map known transport failures.
   * @param {{systemPrompt: string, userPrompt: string}} prompts - Analyzer prompts.
   * @returns {Promise<unknown>} Parsed untrusted JSON value.
   */
  async requestAnalysis(prompts) {
    const initialMaxTokens = this.config.maxTokens;
    try {
      const rawAnalysis = await this.completeAnalysis(prompts, initialMaxTokens);
      return { rawAnalysis, maxOutputTokens: initialMaxTokens };
    } catch (error) {
      if (!(error instanceof GroqJsonClientError)) {
        throw error;
      }
      if (error.code !== GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED) {
        throw this.mapGroqError(error);
      }
      const retryMaxTokens = this.calculateRetryMaxTokens(error, initialMaxTokens);
      if (retryMaxTokens === null) {
        throw new OfferAnalyzerError(
          OfferAnalyzerError.CODE.ANALYZER_PROVIDER_TOKEN_BUDGET,
          {},
          error,
        );
      }
      try {
        const rawAnalysis = await this.completeAnalysis(prompts, retryMaxTokens);
        return { rawAnalysis, maxOutputTokens: retryMaxTokens };
      } catch (retryError) {
        if (!(retryError instanceof GroqJsonClientError)) {
          throw retryError;
        }
        if (retryError.code === GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED) {
          throw new OfferAnalyzerError(
            OfferAnalyzerError.CODE.ANALYZER_PROVIDER_TOKEN_BUDGET,
            {},
            retryError,
          );
        }
        throw this.mapGroqError(retryError);
      }
    }
  }

  /**
   * Submit one Analyzer completion with an explicit output ceiling.
   * @param {{systemPrompt: string, userPrompt: string}} prompts - Exact Analyzer prompts.
   * @param {number} maxTokens - Output ceiling for this attempt.
   * @returns {Promise<unknown>} Parsed untrusted JSON value.
   */
  async completeAnalysis(prompts, maxTokens) {
    return await this.groqClient.completeJson({
      ...prompts,
      model: this.config.model,
      timeout: this.config.timeout,
      maxTokens,
    });
  }

  /**
   * Derive one strictly lower retry ceiling from safe provider diagnostics.
   * @param {GroqJsonClientError} error - Recognized token-budget rejection.
   * @param {number} currentMaxTokens - Ceiling used by the rejected attempt.
   * @returns {number|null} Safe retry ceiling, or null when retry is unsafe.
   */
  calculateRetryMaxTokens(error, currentMaxTokens) {
    const { limitTokens, requestedTokens } = error.safeDetails;
    const values = [currentMaxTokens, limitTokens, requestedTokens];
    const validValues = values.every((value) => {
      return Number.isSafeInteger(value) && value > 0;
    });
    if (!validValues || requestedTokens <= limitTokens
      || requestedTokens <= currentMaxTokens) {
      return null;
    }
    const promptTokens = requestedTokens - currentMaxTokens;
    if (promptTokens <= 0) {
      return null;
    }
    const safeMax = Math.floor(
      limitTokens
      - promptTokens
      - OfferAnalyzerConstants.TOKEN_BUDGET_SAFETY_MARGIN,
    );
    const retryMaxTokens = Math.min(currentMaxTokens, safeMax);
    if (!Number.isSafeInteger(safeMax)
      || safeMax >= currentMaxTokens
      || safeMax < OfferAnalyzerConstants.MINIMUM_RETRY_OUTPUT_TOKENS
      || retryMaxTokens >= currentMaxTokens) {
      return null;
    }
    return retryMaxTokens;
  }

  /**
   * Map one safe transport error into the analyzer error taxonomy.
   * @param {GroqJsonClientError} error - Known Groq transport failure.
   * @returns {OfferAnalyzerError} Stable analyzer failure.
   * @throws {GroqJsonClientError} Unknown transport contract errors.
   */
  mapGroqError(error) {
    const mappings = {
      [GroqJsonClientError.CODE.UNAVAILABLE]: OfferAnalyzerError.CODE.ANALYZER_UNAVAILABLE,
      [GroqJsonClientError.CODE.AUTHENTICATION_ERROR]: OfferAnalyzerError.CODE.ANALYZER_UNAVAILABLE,
      [GroqJsonClientError.CODE.TIMEOUT]: OfferAnalyzerError.CODE.ANALYZER_TIMEOUT,
      [GroqJsonClientError.CODE.RATE_LIMITED]: OfferAnalyzerError.CODE.ANALYZER_RATE_LIMITED,
      [GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED]:
        OfferAnalyzerError.CODE.ANALYZER_PROVIDER_TOKEN_BUDGET,
      [GroqJsonClientError.CODE.HTTP_ERROR]: OfferAnalyzerError.CODE.ANALYZER_PROVIDER_ERROR,
      [GroqJsonClientError.CODE.INVALID_RESPONSE]: OfferAnalyzerError.CODE.ANALYZER_INVALID_OUTPUT,
    };
    const code = mappings[error.code];
    if (!code) {
      throw error;
    }
    return new OfferAnalyzerError(code, {}, error);
  }

  /**
   * Build the default execution configuration for direct server-side injection.
   * @param {string} model - Explicit non-empty model identifier.
   * @returns {object} Analyzer V1 execution configuration.
   */
  static buildConfig(model) {
    return {
      provider: OfferAnalyzerConstants.PROVIDER,
      model,
      policyVersion: OfferAnalyzerConstants.POLICY_VERSION,
      timeout: OfferAnalyzerConstants.TIMEOUT_MS,
      maxTokens: OfferAnalyzerConstants.MAX_OUTPUT_TOKENS,
      maxInputLength: OfferAnalyzerConstants.MAX_INPUT_LENGTH,
    };
  }
}

export { OfferAnalyzerService };
