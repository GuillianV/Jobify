import { ApplicationBriefMatcherConstants } from "../constants/ApplicationBriefMatcherConstants.js";
import { GroqJsonClientError } from "./GroqJsonClientError.js";
import { ApplicationBriefMatcherError } from "./ApplicationBriefMatcherError.js";
import { ApplicationBriefProviderDiagnostics } from "./ApplicationBriefProviderDiagnostics.js";

const STRICT_STRUCTURED_OUTPUT_MODELS = new Set([
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
]);
const LOW_REASONING_EFFORT = "low";
const JSON_OBJECT_RESPONSE_FORMAT = Object.freeze({ type: "json_object" });
const JSON_VALIDATION_RETRY_EVENT = "application_brief_semantic_matcher_retry";
const CROSS_CLASS_SKIP_EVENT = "application_brief_semantic_matcher_cross_class_skip";
const PROVIDER_SUCCESS_EVENT = "application_brief_semantic_matcher_provider_success";
const INITIAL_ATTEMPT = 1;

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
   * Match one minimal projection while preserving the historical semantic-only return value.
   * @param {object} projection - Exact ApplicationBriefInputProjector output.
   * @returns {Promise<object>} Validated semantic-only output.
   */
  async match(projection) {
    const result = await this.matchWithExecution(projection);
    return result.semanticOutput;
  }

  /**
   * Match one projection and retain detached closed provider execution metadata.
   * @param {object} projection - Exact ApplicationBriefInputProjector output.
   * @returns {Promise<{semanticOutput: object, providerExecution: object}>} Validated output and execution metadata.
   */
  async matchWithExecution(projection, boundedSession = {}) {
    const serializedInput = JSON.stringify(projection);
    if (serializedInput.length > this.config.maxInputCharacters) {
      throw new ApplicationBriefMatcherError(
        ApplicationBriefMatcherError.CODE.INPUT_TOO_LARGE,
      );
    }
    const prompts = this.promptBuilder.build(projection);
    const result = await this.requestSemanticOutput(
      prompts,
      this.createBoundedSession(boundedSession),
    );
    const semanticOutput = this.semanticValidator.validate(result.rawOutput);
    return {
      semanticOutput,
      providerExecution: {
        providerCallsMade: result.providerCallsMade,
        successfulMaxTokens: result.successfulMaxTokens,
        ...(Number.isSafeInteger(result.successfulRequestTokenBudget)
          && result.successfulRequestTokenBudget > 0
          ? { successfulRequestTokenBudget: result.successfulRequestTokenBudget }
          : {}),
        ...result.safeRateLimitDetails,
      },
    };
  }

  /**
   * Perform the bounded completion sequence with one technical token retry only.
   * @param {{systemPrompt: string, userPrompt: string}} prompts - Exact prompts.
   * @returns {Promise<object>} Parsed JSON with closed execution metadata.
   */
  async requestSemanticOutput(prompts, execution) {
    const initialMaxTokens = execution.initialMaxTokens;
    try {
      return await this.complete(prompts, initialMaxTokens, INITIAL_ATTEMPT, execution);
    } catch (error) {
      if (!(error instanceof GroqJsonClientError)) {
        throw error;
      }
      let retryMaxTokens = initialMaxTokens;
      let expectedRetryTokenBudget = null;
      let tokenBudgetRetry = false;
      if (this.isJsonValidationRetry(error)) {
        if (!this.hasProviderCallAllowance(execution)) {
          throw this.mapGroqError(error);
        }
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
        expectedRetryTokenBudget = this.calculateExpectedRetryTokenBudget(
          error,
          initialMaxTokens,
          retryMaxTokens,
        );
        if (expectedRetryTokenBudget !== null) {
          execution.successfulRequestTokenBudget = expectedRetryTokenBudget;
        }
        if (!this.hasProviderCallAllowance(execution)) {
          throw this.mapGroqError(error);
        }
        this.logTokenBudgetRetry(error, retryMaxTokens);
        tokenBudgetRetry = true;
      } else {
        throw this.mapGroqError(error);
      }
      try {
        return await this.complete(
          prompts,
          retryMaxTokens,
          ApplicationBriefMatcherConstants.RETRY_ATTEMPT,
          execution,
        );
      } catch (retryError) {
        if (!(retryError instanceof GroqJsonClientError)) {
          throw retryError;
        }
        if (tokenBudgetRetry && this.isJsonValidationRetry(retryError)) {
          if (!this.hasProviderCallAllowance(execution)) {
            throw this.mapGroqError(retryError);
          }
          if (this.shouldSkipCrossClassRetry(retryError, expectedRetryTokenBudget)) {
            this.logCrossClassSkip(retryError, expectedRetryTokenBudget);
            throw new ApplicationBriefMatcherError(
              ApplicationBriefMatcherError.CODE.RATE_LIMITED,
              ApplicationBriefMatcherError.REASON.RATE_LIMIT_HEADROOM_SKIP,
            );
          }
          this.logCrossClassRetry(retryError, retryMaxTokens);
          return await this.requestFinalCrossClassOutput(prompts, retryMaxTokens, execution);
        }
        throw this.mapGroqError(retryError);
      }
    }
  }

  /**
   * Determine whether typed Attempt-2 token headroom cannot fit the identical final request.
   * @param {GroqJsonClientError} error - Targeted second-attempt JSON failure.
   * @param {number|null} requiredTokenBudget - Derived reduced request budget.
   * @returns {boolean} Whether the final cross-class request must be skipped.
   */
  shouldSkipCrossClassRetry(error, requiredTokenBudget) {
    const remaining = error.safeDetails?.rateLimitTokenRemaining;
    return this.config.model === ApplicationBriefMatcherConstants.JSON_VALIDATION_RETRY_MODEL
      && Number.isSafeInteger(requiredTokenBudget)
      && requiredTokenBudget > 0
      && Number.isSafeInteger(remaining)
      && remaining >= 0
      && remaining < requiredTokenBudget;
  }

  /**
   * Emit one closed diagnostic for a final cross-class request skipped locally.
   * @param {GroqJsonClientError} error - Targeted second-attempt JSON failure.
   * @param {number} requiredTokenBudget - Derived reduced request budget.
   * @returns {void}
   */
  logCrossClassSkip(error, requiredTokenBudget) {
    try {
      this.logger.warn(JSON.stringify({
        event: CROSS_CLASS_SKIP_EVENT,
        nextAttempt: ApplicationBriefMatcherConstants.FINAL_CROSS_CLASS_RETRY_ATTEMPT,
        decision: ApplicationBriefMatcherError.REASON.RATE_LIMIT_HEADROOM_SKIP,
        rateLimitTokenRemaining: error.safeDetails.rateLimitTokenRemaining,
        requiredTokenBudget,
      }));
    } catch {
      return;
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
        ...ApplicationBriefProviderDiagnostics.createRateLimitDetails(error.safeDetails),
      }));
    } catch {
      return;
    }
  }

  /**
   * Emit one closed diagnostic after a recognized token-budget retry is scheduled.
   * @param {GroqJsonClientError} error - Recognized token-budget failure.
   * @param {number} nextMaxTokens - Validated lower output ceiling.
   * @returns {void}
   */
  logTokenBudgetRetry(error, nextMaxTokens) {
    const constants = ApplicationBriefMatcherConstants;
    try {
      this.logger.warn(JSON.stringify({
        event: JSON_VALIDATION_RETRY_EVENT,
        nextAttempt: constants.RETRY_ATTEMPT,
        retryReason: constants.TOKEN_BUDGET_RETRY_REASON,
        status: constants.TOKEN_BUDGET_HTTP_STATUS,
        providerType: constants.TOKEN_BUDGET_PROVIDER_TYPE,
        providerCode: constants.TOKEN_BUDGET_PROVIDER_CODE,
        limitTokens: error.safeDetails.limitTokens,
        requestedTokens: error.safeDetails.requestedTokens,
        nextMaxTokens,
        ...ApplicationBriefProviderDiagnostics.createRateLimitDetails(error.safeDetails),
      }));
    } catch {
      return;
    }
  }

  /**
   * Emit one closed diagnostic for the final JSON recovery after a token-budget retry.
   * @param {GroqJsonClientError} error - Targeted second-attempt provider failure.
   * @param {number} nextMaxTokens - Reused reduced output ceiling.
   * @returns {void}
   */
  logCrossClassRetry(error, nextMaxTokens) {
    const constants = ApplicationBriefMatcherConstants;
    try {
      this.logger.warn(JSON.stringify({
        event: JSON_VALIDATION_RETRY_EVENT,
        nextAttempt: constants.FINAL_CROSS_CLASS_RETRY_ATTEMPT,
        retryReason: constants.CROSS_CLASS_RETRY_REASON,
        status: error.safeDetails.status,
        providerType: error.safeDetails.providerType,
        providerCode: error.safeDetails.providerCode,
        nextMaxTokens,
        ...ApplicationBriefProviderDiagnostics.createRateLimitDetails(error.safeDetails),
      }));
    } catch {
      return;
    }
  }

  /**
   * Perform the single final cross-class call and preserve its terminal classification.
   * @param {{systemPrompt: string, userPrompt: string}} prompts - Exact prompts.
   * @param {number} maxTokens - Existing reduced output ceiling.
   * @param {object} execution - Mutable matcher-session call accounting.
   * @returns {Promise<object>} Parsed JSON with closed execution metadata.
   */
  async requestFinalCrossClassOutput(prompts, maxTokens, execution) {
    try {
      return await this.complete(
        prompts,
        maxTokens,
        ApplicationBriefMatcherConstants.FINAL_CROSS_CLASS_RETRY_ATTEMPT,
        execution,
      );
    } catch (error) {
      if (!(error instanceof GroqJsonClientError)) {
        throw error;
      }
      throw this.mapGroqError(error);
    }
  }

  /**
   * Submit one JSON completion with explicit injected settings.
   * @param {{systemPrompt: string, userPrompt: string}} prompts - Exact prompts.
   * @param {number} maxTokens - Attempt output ceiling.
   * @param {number} attempt - Exact provider attempt number.
   * @param {object} execution - Mutable matcher-session call accounting.
   * @returns {Promise<object>} Parsed JSON with closed execution metadata.
   */
  async complete(prompts, maxTokens, attempt, execution) {
    if (!this.hasProviderCallAllowance(execution)) {
      throw new ApplicationBriefMatcherError(
        ApplicationBriefMatcherError.CODE.PROVIDER_ERROR,
      );
    }
    const request = {
      ...prompts,
      model: this.config.model,
      timeout: this.config.timeout,
      maxTokens,
    };
    if (STRICT_STRUCTURED_OUTPUT_MODELS.has(this.config.model)) {
      request.responseFormat = JSON_OBJECT_RESPONSE_FORMAT;
      request.reasoningEffort = LOW_REASONING_EFFORT;
    }
    execution.providerCallsMade += 1;
    const result = await this.groqClient.completeJsonWithMetadata(request);
    this.logProviderSuccess(result.value, attempt, maxTokens);
    return {
      rawOutput: result.value,
      providerCallsMade: execution.providerCallsMade,
      successfulMaxTokens: maxTokens,
      ...(Number.isSafeInteger(execution.successfulRequestTokenBudget)
        && execution.successfulRequestTokenBudget > 0
        ? { successfulRequestTokenBudget: execution.successfulRequestTokenBudget }
        : {}),
      safeRateLimitDetails: { ...result.safeRateLimitDetails },
    };
  }

  /**
   * Create one validated internal provider-call session with historical defaults.
   * @param {object} boundedSession - Optional continuation inputs.
   * @returns {object} Mutable bounded execution state.
   */
  createBoundedSession(boundedSession) {
    const constants = ApplicationBriefMatcherConstants;
    const startingProviderCallsMade = boundedSession.startingProviderCallsMade ?? 0;
    const providerCallCap = boundedSession.providerCallCap
      ?? constants.ABSOLUTE_PROVIDER_CALL_CAP;
    const initialMaxTokens = boundedSession.initialMaxTokens ?? this.config.maxTokens;
    const valid = Number.isSafeInteger(startingProviderCallsMade)
      && startingProviderCallsMade >= 0
      && providerCallCap === constants.ABSOLUTE_PROVIDER_CALL_CAP
      && startingProviderCallsMade <= providerCallCap
      && Number.isSafeInteger(initialMaxTokens)
      && initialMaxTokens > 0;
    if (!valid) {
      throw new TypeError("Invalid ApplicationBrief bounded provider session");
    }
    return {
      providerCallsMade: startingProviderCallsMade,
      providerCallCap,
      initialMaxTokens,
    };
  }

  /**
   * Determine whether one actual provider call remains in the global session.
   * @param {object} execution - Mutable bounded execution state.
   * @returns {boolean} Whether a provider call may start.
   */
  hasProviderCallAllowance(execution) {
    return execution.providerCallsMade < execution.providerCallCap;
  }

  /**
   * Emit one closed non-fatal size diagnostic after provider JSON parsing succeeds.
   * @param {unknown} output - Parsed provider semantic output.
   * @param {number} attempt - Exact successful provider attempt number.
   * @param {number} maxTokens - Completion ceiling used by the successful attempt.
   * @returns {void}
   */
  logProviderSuccess(output, attempt, maxTokens) {
    try {
      const serialized = JSON.stringify(output);
      const semanticOutputJsonCharacters = serialized.length;
      if (!Number.isSafeInteger(semanticOutputJsonCharacters)
        || semanticOutputJsonCharacters < 0) {
        return;
      }
      this.logger.warn(JSON.stringify({
        event: PROVIDER_SUCCESS_EVENT,
        attempt,
        maxTokens,
        semanticOutputJsonCharacters,
      }));
    } catch {
      return;
    }
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
   * Derive the complete token budget of the reduced request from recognized 413 metrics.
   * @param {GroqJsonClientError} error - Recognized initial token-budget error.
   * @param {number} currentMaxTokens - Rejected initial output ceiling.
   * @param {number} retryMaxTokens - Validated reduced output ceiling.
   * @returns {number|null} Safe positive reduced request budget or null.
   */
  calculateExpectedRetryTokenBudget(error, currentMaxTokens, retryMaxTokens) {
    const requestedTokens = error.safeDetails?.requestedTokens;
    const values = [requestedTokens, currentMaxTokens, retryMaxTokens];
    if (!values.every((value) => {
      return Number.isSafeInteger(value) && value > 0;
    }) || requestedTokens <= currentMaxTokens) {
      return null;
    }
    const promptTokens = requestedTokens - currentMaxTokens;
    const requiredTokenBudget = promptTokens + retryMaxTokens;
    return Number.isSafeInteger(requiredTokenBudget) && requiredTokenBudget > 0
      ? requiredTokenBudget
      : null;
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
