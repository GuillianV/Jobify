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
   * Reload, verify and analyze one persisted offer without persistence or retry.
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
    const rawAnalysis = await this.requestAnalysis(prompts);
    let offerAnalysis;
    try {
      offerAnalysis = this.analysisValidator.validate(rawAnalysis, input.effectiveText);
    } catch (error) {
      if (!(error instanceof OfferAnalysisValidationError)) {
        throw error;
      }
      throw new OfferAnalyzerError(
        OfferAnalyzerError.CODE.ANALYZER_INVALID_OUTPUT,
        { validationCode: error.validationCode },
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
   * Perform the single Groq request and map only known transport failures.
   * @param {{systemPrompt: string, userPrompt: string}} prompts - Analyzer prompts.
   * @returns {Promise<unknown>} Parsed untrusted JSON value.
   */
  async requestAnalysis(prompts) {
    try {
      return await this.groqClient.completeJson({
        ...prompts,
        model: this.config.model,
        timeout: this.config.timeout,
        maxTokens: this.config.maxTokens,
      });
    } catch (error) {
      if (!(error instanceof GroqJsonClientError)) {
        throw error;
      }
      throw this.mapGroqError(error);
    }
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
