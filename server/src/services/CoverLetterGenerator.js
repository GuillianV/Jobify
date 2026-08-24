import { CoverLetterGeneratorConstants } from "../constants/CoverLetterGeneratorConstants.js";
import { GroqJsonClientError } from "./GroqJsonClientError.js";
import { CoverLetterGeneratorError } from "./CoverLetterGeneratorError.js";

const ROOT_KEYS = Object.freeze(["offer", "claims", "boundaries"]);
const RATE_LIMIT_DIAGNOSTIC_EVENT = "cover_letter_provider_rate_limited";

/**
 * Generates one validated CoverLetter from a minimal deterministic projection.
 */
class CoverLetterGenerator {
  /**
   * Create the generator with prompt, transport, validator and execution policy dependencies.
   * @param {object} dependencies - Generator dependencies.
   * @param {import("./CoverLetterPrompt.js").CoverLetterPrompt} dependencies.promptBuilder - Prompt builder.
   * @param {import("./GroqJsonClient.js").GroqJsonClient} dependencies.groqClient - JSON transport.
   * @param {import("./CoverLetterOutputValidator.js").CoverLetterOutputValidator} dependencies.outputValidator - CoverLetter output validator.
   * @param {object} dependencies.config - Generator execution configuration.
   * @param {{warn: (message: string) => void}} [dependencies.logger=console] - Safe diagnostic logger.
   */
  constructor({ promptBuilder, groqClient, outputValidator, config, logger = console }) {
    this.promptBuilder = promptBuilder;
    this.groqClient = groqClient;
    this.outputValidator = outputValidator;
    this.config = Object.freeze({ ...config });
    this.logger = logger;
  }

  /**
   * Generate one cover letter without mutating or filtering the projected input.
   * @param {object} generationInput - Exact CoverLetterInputProjector output.
   * @returns {Promise<import("../models/CoverLetter.js").CoverLetter>} Validated immutable domain value.
   */
  async generate(generationInput) {
    this.validateGenerationInput(generationInput);
    const serializedInput = JSON.stringify(generationInput);
    if (serializedInput.length > this.config.maxInputCharacters) {
      throw new CoverLetterGeneratorError(CoverLetterGeneratorError.CODE.INPUT_TOO_LARGE);
    }
    if (generationInput.claims.length === 0) {
      throw new CoverLetterGeneratorError(
        CoverLetterGeneratorError.CODE.INSUFFICIENT_SUPPORTED_CLAIMS,
      );
    }
    const prompts = this.promptBuilder.build(generationInput);
    const rawOutput = await this.requestOutput(prompts);
    let coverLetter;
    try {
      coverLetter = this.outputValidator.validate(rawOutput);
    } catch (error) {
      if (!(error instanceof TypeError)) {
        throw error;
      }
      throw new CoverLetterGeneratorError(
        CoverLetterGeneratorError.CODE.INVALID_OUTPUT,
        error,
      );
    }
    this.validateUsedClaimIndexes(coverLetter.usedClaimIndexes, generationInput.claims);
    return coverLetter;
  }

  /**
   * Validate only the minimal safe preconditions of the projected generation input.
   * @param {unknown} input - Generation input candidate.
   * @returns {void}
   */
  validateGenerationInput(input) {
    this.validateJsonValue(input, new Set());
    if (!this.hasExactKeys(input, ROOT_KEYS)
      || !this.isPlainObject(input.offer)
      || !Array.isArray(input.claims)
      || !this.isPlainObject(input.boundaries)) {
      throw new TypeError("CoverLetterGenerator requires the exact projection root");
    }
    const indexes = new Set();
    for (const claim of input.claims) {
      if (!this.isPlainObject(claim)
        || !Number.isSafeInteger(claim.index)
        || claim.index < 0
        || indexes.has(claim.index)) {
        throw new TypeError("CoverLetterGenerator claim indexes are invalid");
      }
      indexes.add(claim.index);
    }
  }

  /**
   * Require one plain JSON-compatible acyclic value without rewriting it.
   * @param {unknown} value - JSON value candidate.
   * @param {Set<object>} active - Objects in the current traversal path.
   * @returns {void}
   */
  validateJsonValue(value, active) {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      return;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new TypeError("CoverLetterGenerator input requires finite numbers");
      }
      return;
    }
    if ((Array.isArray(value) || this.isPlainObject(value)) && !active.has(value)) {
      active.add(value);
      for (const child of Array.isArray(value) ? value : Object.values(value)) {
        this.validateJsonValue(child, active);
      }
      active.delete(value);
      return;
    }
    throw new TypeError("CoverLetterGenerator input must be plain JSON-compatible data");
  }

  /**
   * Perform one completion with at most one technical token-budget retry.
   * @param {{systemPrompt: string, userPrompt: string}} prompts - Exact generation prompts.
   * @returns {Promise<unknown>} Parsed untrusted provider JSON.
   */
  async requestOutput(prompts) {
    const initialMaxTokens = this.config.maxTokens;
    try {
      return await this.complete(prompts, initialMaxTokens);
    } catch (error) {
      if (!(error instanceof GroqJsonClientError)) {
        throw error;
      }
      if (error.code !== GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED) {
        throw this.mapGroqError(error);
      }
      const retryMaxTokens = this.calculateRetryMaxTokens(error, initialMaxTokens);
      if (retryMaxTokens === null) {
        throw new CoverLetterGeneratorError(
          CoverLetterGeneratorError.CODE.PROVIDER_TOKEN_BUDGET,
          error,
        );
      }
      try {
        return await this.complete(prompts, retryMaxTokens);
      } catch (retryError) {
        if (!(retryError instanceof GroqJsonClientError)) {
          throw retryError;
        }
        if (retryError.code === GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED) {
          throw new CoverLetterGeneratorError(
            CoverLetterGeneratorError.CODE.PROVIDER_TOKEN_BUDGET,
            retryError,
          );
        }
        throw this.mapGroqError(retryError);
      }
    }
  }

  /**
   * Submit one JSON completion with explicit injected settings.
   * @param {{systemPrompt: string, userPrompt: string}} prompts - Exact prompts.
   * @param {number} maxTokens - Attempt output ceiling.
   * @returns {Promise<unknown>} Parsed provider JSON.
   */
  async complete(prompts, maxTokens) {
    return await this.groqClient.completeJson({
      ...prompts,
      model: this.config.model,
      timeout: this.config.timeout,
      maxTokens,
    });
  }

  /**
   * Derive one strictly lower safe retry ceiling from recognized provider diagnostics.
   * @param {GroqJsonClientError} error - Token-budget rejection.
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
      - CoverLetterGeneratorConstants.TOKEN_BUDGET_SAFETY_MARGIN,
    );
    const retryMaxTokens = Math.min(currentMaxTokens, safeMax);
    if (!Number.isSafeInteger(safeMax)
      || safeMax >= currentMaxTokens
      || safeMax < CoverLetterGeneratorConstants.MINIMUM_RETRY_OUTPUT_TOKENS
      || retryMaxTokens >= currentMaxTokens) {
      return null;
    }
    return retryMaxTokens;
  }

  /**
   * Validate generated claim indexes against the exact non-contiguous input indexes.
   * @param {number[]} usedIndexes - Structurally valid generated indexes.
   * @param {object[]} claims - Input claims.
   * @returns {void}
   */
  validateUsedClaimIndexes(usedIndexes, claims) {
    const available = new Set(claims.map((claim) => {
      return claim.index;
    }));
    if (usedIndexes.some((index) => {
      return !available.has(index);
    })) {
      throw new CoverLetterGeneratorError(CoverLetterGeneratorError.CODE.INVALID_OUTPUT);
    }
  }

  /**
   * Map recognized transport failures into safe generation failures.
   * @param {GroqJsonClientError} error - Transport failure.
   * @returns {CoverLetterGeneratorError} Stable generator failure.
   * @throws {GroqJsonClientError} Unknown transport contract failure.
   */
  mapGroqError(error) {
    const mappings = {
      [GroqJsonClientError.CODE.UNAVAILABLE]: CoverLetterGeneratorError.CODE.UNAVAILABLE,
      [GroqJsonClientError.CODE.AUTHENTICATION_ERROR]: CoverLetterGeneratorError.CODE.UNAVAILABLE,
      [GroqJsonClientError.CODE.TIMEOUT]: CoverLetterGeneratorError.CODE.TIMEOUT,
      [GroqJsonClientError.CODE.RATE_LIMITED]: CoverLetterGeneratorError.CODE.RATE_LIMITED,
      [GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED]:
        CoverLetterGeneratorError.CODE.PROVIDER_TOKEN_BUDGET,
      [GroqJsonClientError.CODE.HTTP_ERROR]: CoverLetterGeneratorError.CODE.PROVIDER_ERROR,
      [GroqJsonClientError.CODE.INVALID_RESPONSE]: CoverLetterGeneratorError.CODE.INVALID_OUTPUT,
    };
    const code = mappings[error.code];
    if (code === undefined) {
      throw error;
    }
    if (code === CoverLetterGeneratorError.CODE.RATE_LIMITED) {
      this.logRateLimitDiagnostic(error);
    }
    return new CoverLetterGeneratorError(code, error);
  }

  /**
   * Emit one closed non-fatal diagnostic for terminal provider rate limiting.
   * @param {GroqJsonClientError} error - Typed provider rate-limit failure.
   * @returns {void}
   */
  logRateLimitDiagnostic(error) {
    try {
      const sanitized = GroqJsonClientError.createRateLimitSafeDetails(error.safeDetails);
      const available = Object.fromEntries(Object.entries(sanitized).filter(([, value]) => {
        return value !== null;
      }));
      this.logger.warn(JSON.stringify({
        event: RATE_LIMIT_DIAGNOSTIC_EVENT,
        ...available,
      }));
    } catch {
      return;
    }
  }

  /**
   * Test one exact plain-object key set.
   * @param {unknown} value - Object candidate.
   * @param {string[]} expectedKeys - Exact keys.
   * @returns {boolean} Whether keys are exact.
   */
  hasExactKeys(value, expectedKeys) {
    if (!this.isPlainObject(value)) {
      return false;
    }
    const keys = Object.keys(value);
    return keys.length === expectedKeys.length && keys.every((key) => {
      return expectedKeys.includes(key);
    });
  }

  /**
   * Test whether one value is a plain object.
   * @param {unknown} value - Object candidate.
   * @returns {boolean} Whether the value is plain.
   */
  isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      && Object.getPrototypeOf(value) === Object.prototype;
  }

  /**
   * Build the generator execution configuration for direct injection.
   * @param {string} model - Explicit model identifier.
   * @returns {object} CoverLetter V1 execution configuration.
   */
  static buildConfig(model) {
    return {
      model,
      timeout: CoverLetterGeneratorConstants.TIMEOUT_MS,
      maxTokens: CoverLetterGeneratorConstants.MAX_OUTPUT_TOKENS,
      maxInputCharacters: CoverLetterGeneratorConstants.MAX_INPUT_CHARACTERS,
    };
  }
}

export { CoverLetterGenerator };
