import { ApplicationBriefMatcherConstants } from "../constants/ApplicationBriefMatcherConstants.js";
import { ApplicationBriefSemanticJsonSchema } from "../constants/ApplicationBriefSemanticJsonSchema.js";
import { GroqJsonClientError } from "./GroqJsonClientError.js";
import { ApplicationBriefMatcherError } from "./ApplicationBriefMatcherError.js";

const STRICT_STRUCTURED_OUTPUT_MODELS = new Set([
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
]);
const LOW_REASONING_EFFORT = "low";
const JSON_VALIDATION_RETRY_EVENT = "application_brief_semantic_matcher_retry";

/**
 * Performs one bounded LLM semantic match over a minimal projected input.
 */
class ApplicationBriefSemanticMatcher {
  /**
   * Create the matcher with injected prompt, transport, validator and execution policy.
   * @param {object} dependencies - Matcher dependencies.
   * @param {import("./ApplicationBriefPrompt.js").ApplicationBriefPrompt} dependencies.promptBuilder - Prompt builder.
   * @param {import("./GroqJsonClient.js").GroqJsonClient} dependencies.groqClient - JSON transport.
   * @param {import("./ApplicationBriefSemanticOutputValidator.js").ApplicationBriefSemanticOutputValidator} dependencies.semanticValidator - Semantic validator.
   * @param {object} dependencies.config - Matcher execution configuration.
   * @param {{warn: (message: string) => void}} [dependencies.logger=console] - Safe diagnostic logger.
   */
  constructor({ promptBuilder, groqClient, semanticValidator, config, logger = console }) {
    this.promptBuilder = promptBuilder;
    this.groqClient = groqClient;
    this.semanticValidator = semanticValidator;
    this.config = Object.freeze({ ...config });
    this.logger = logger;
  }

  /**
   * Match one minimal projection and return detached strictly validated semantics.
   * @param {object} projection - Exact ApplicationBriefInputProjector output.
   * @returns {Promise<object>} Validated semantic-only output.
   */
  async match(projection) {
    const serializedInput = JSON.stringify(projection);
    if (serializedInput.length > this.config.maxInputCharacters) {
      throw new ApplicationBriefMatcherError(
        ApplicationBriefMatcherError.CODE.INPUT_TOO_LARGE,
      );
    }
    const prompts = this.promptBuilder.build(projection);
    const rawOutput = await this.requestSemanticOutput(prompts);
    return this.semanticValidator.validate(rawOutput);
  }

  /**
   * Perform the bounded completion sequence with one technical token retry only.
   * @param {{systemPrompt: string, userPrompt: string}} prompts - Exact prompts.
   * @returns {Promise<unknown>} Parsed untrusted provider JSON.
   */
  async requestSemanticOutput(prompts) {
    const initialMaxTokens = this.config.maxTokens;
    try {
      return await this.complete(prompts, initialMaxTokens);
    } catch (error) {
      if (!(error instanceof GroqJsonClientError)) {
        throw error;
      }
      let retryMaxTokens = initialMaxTokens;
      if (this.isJsonValidationRetry(error)) {
        this.logJsonValidationRetry(error);
      } else if (error.code === GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED) {
        retryMaxTokens = this.calculateRetryMaxTokens(error, initialMaxTokens);
        if (retryMaxTokens === null) {
          throw new ApplicationBriefMatcherError(
            ApplicationBriefMatcherError.CODE.PROVIDER_TOKEN_BUDGET,
            null,
            error,
          );
        }
      } else {
        throw this.mapGroqError(error);
      }
      try {
        return await this.complete(prompts, retryMaxTokens);
      } catch (retryError) {
        if (!(retryError instanceof GroqJsonClientError)) {
          throw retryError;
        }
        throw this.mapGroqError(retryError);
      }
    }
  }

  /**
   * Identify the one transient provider validation failure eligible for an identical retry.
   * @param {GroqJsonClientError} error - Typed transport failure.
   * @returns {boolean} Whether one identical retry is allowed.
   */
  isJsonValidationRetry(error) {
    const constants = ApplicationBriefMatcherConstants;
    return this.config.model === constants.JSON_VALIDATION_RETRY_MODEL
      && error.code === GroqJsonClientError.CODE.HTTP_ERROR
      && error.safeDetails.status === constants.JSON_VALIDATION_HTTP_STATUS
      && error.safeDetails.providerType === constants.JSON_VALIDATION_PROVIDER_TYPE
      && error.safeDetails.providerCode === constants.JSON_VALIDATION_PROVIDER_CODE;
  }

  /**
   * Emit one closed diagnostic for a scheduled identical provider retry.
   * @param {GroqJsonClientError} error - Targeted safe provider failure.
   * @returns {void}
   */
  logJsonValidationRetry(error) {
    try {
      this.logger.warn(JSON.stringify({
        event: JSON_VALIDATION_RETRY_EVENT,
        attempt: ApplicationBriefMatcherConstants.RETRY_ATTEMPT,
        status: error.safeDetails.status,
        providerType: error.safeDetails.providerType,
        providerCode: error.safeDetails.providerCode,
      }));
    } catch {
      return;
    }
  }

  /**
   * Submit one JSON completion with explicit injected settings.
   * @param {{systemPrompt: string, userPrompt: string}} prompts - Exact prompts.
   * @param {number} maxTokens - Attempt output ceiling.
   * @returns {Promise<unknown>} Parsed provider JSON.
   */
  async complete(prompts, maxTokens) {
    const request = {
      ...prompts,
      model: this.config.model,
      timeout: this.config.timeout,
      maxTokens,
    };
    if (STRICT_STRUCTURED_OUTPUT_MODELS.has(this.config.model)) {
      request.responseFormat = ApplicationBriefSemanticJsonSchema.createResponseFormat();
      request.reasoningEffort = LOW_REASONING_EFFORT;
    }
    return await this.groqClient.completeJson(request);
  }

  /**
   * Derive one strictly lower safe retry ceiling from recognized diagnostics.
   * @param {GroqJsonClientError} error - Token-budget error.
   * @param {number} currentMaxTokens - Rejected output ceiling.
   * @returns {number|null} Reduced retry ceiling or null.
   */
  calculateRetryMaxTokens(error, currentMaxTokens) {
    const { limitTokens, requestedTokens } = error.safeDetails;
    const values = [currentMaxTokens, limitTokens, requestedTokens];
    if (!values.every((value) => {
      return Number.isSafeInteger(value) && value > 0;
    }) || requestedTokens <= limitTokens || requestedTokens <= currentMaxTokens) {
      return null;
    }
    const promptTokens = requestedTokens - currentMaxTokens;
    if (promptTokens <= 0) {
      return null;
    }
    const safeMax = Math.floor(
      limitTokens
      - promptTokens
      - ApplicationBriefMatcherConstants.TOKEN_BUDGET_SAFETY_MARGIN,
    );
    const retryMaxTokens = Math.min(currentMaxTokens, safeMax);
    if (!Number.isSafeInteger(safeMax)
      || safeMax >= currentMaxTokens
      || safeMax < ApplicationBriefMatcherConstants.MINIMUM_RETRY_OUTPUT_TOKENS
      || retryMaxTokens >= currentMaxTokens) {
      return null;
    }
    return retryMaxTokens;
  }

  /**
   * Map recognized transport failures into safe matcher failures.
   * @param {GroqJsonClientError} error - Transport failure.
   * @returns {ApplicationBriefMatcherError} Stable matcher failure.
   * @throws {GroqJsonClientError} Unknown transport contract failure.
   */
  mapGroqError(error) {
    if (error.code === GroqJsonClientError.CODE.INVALID_RESPONSE) {
      return new ApplicationBriefMatcherError(
        ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
        ApplicationBriefMatcherError.REASON.INVALID_SEMANTIC_OUTPUT,
        error,
      );
    }
    const mappings = {
      [GroqJsonClientError.CODE.UNAVAILABLE]: ApplicationBriefMatcherError.CODE.UNAVAILABLE,
      [GroqJsonClientError.CODE.AUTHENTICATION_ERROR]:
        ApplicationBriefMatcherError.CODE.UNAVAILABLE,
      [GroqJsonClientError.CODE.TIMEOUT]: ApplicationBriefMatcherError.CODE.TIMEOUT,
      [GroqJsonClientError.CODE.RATE_LIMITED]: ApplicationBriefMatcherError.CODE.RATE_LIMITED,
      [GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED]:
        ApplicationBriefMatcherError.CODE.PROVIDER_TOKEN_BUDGET,
      [GroqJsonClientError.CODE.HTTP_ERROR]: ApplicationBriefMatcherError.CODE.PROVIDER_ERROR,
    };
    const code = mappings[error.code];
    if (!code) {
      throw error;
    }
    return new ApplicationBriefMatcherError(code, null, error);
  }

  /**
   * Build the matcher execution configuration for direct injection.
   * @param {string} model - Explicit model identifier.
   * @returns {object} Matcher V1 configuration.
   */
  static buildConfig(model) {
    return {
      model,
      timeout: ApplicationBriefMatcherConstants.TIMEOUT_MS,
      maxTokens: ApplicationBriefMatcherConstants.MAX_OUTPUT_TOKENS,
      maxInputCharacters: ApplicationBriefMatcherConstants.MAX_INPUT_CHARACTERS,
    };
  }
}

export { ApplicationBriefSemanticMatcher };
