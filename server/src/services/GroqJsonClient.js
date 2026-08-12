import { GroqConstants } from "../constants/GroqConstants.js";
import { GroqJsonClientError } from "./GroqJsonClientError.js";

const HTTP_STATUS_UNAUTHORIZED = 401;
const HTTP_STATUS_FORBIDDEN = 403;
const HTTP_STATUS_CONTENT_TOO_LARGE = 413;
const HTTP_STATUS_RATE_LIMITED = 429;
const TOKEN_BUDGET_ERROR_TYPE = "tokens";
const TOKEN_BUDGET_ERROR_CODE = "rate_limit_exceeded";
const TOKEN_BUDGET_LIMIT_LABEL_PATTERN = /\bLimit\b/gu;
const TOKEN_BUDGET_REQUESTED_LABEL_PATTERN = /\bRequested\b/gu;
const TOKEN_BUDGET_PATTERN = /\bLimit\s+(\d+)(?![\d.]),\s*Requested\s+(\d+)(?![\d.])/gu;

/**
 * Performs one provider-agnostic JSON chat completion through Groq transport.
 */
class GroqJsonClient {
  /**
   * Create the client with injectable network and timer primitives.
   * @param {object} config - Client dependencies.
   * @param {string} config.apiKey - Groq API key.
   * @param {Function} config.fetchImpl - Fetch-compatible transport.
   * @param {string} [config.endpoint] - Chat completion endpoint.
   * @param {Function} [config.setTimeoutImpl] - Timer scheduler.
   * @param {Function} [config.clearTimeoutImpl] - Timer cleanup.
   */
  constructor({
    apiKey,
    fetchImpl,
    endpoint = GroqConstants.CHAT_ENDPOINT,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
  }) {
    if (typeof fetchImpl !== "function") {
      throw new TypeError("GroqJsonClient requires fetchImpl");
    }
    this.apiKey = typeof apiKey === "string" ? apiKey.trim() : "";
    this.fetchImpl = fetchImpl;
    this.endpoint = endpoint;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
  }

  /**
   * Request and parse one syntactically valid JSON value from Groq.
   * @param {object} request - Completion input.
   * @param {string} request.systemPrompt - Non-empty system prompt.
   * @param {string} request.userPrompt - Non-empty user prompt.
   * @param {string} request.model - Non-empty model identifier.
   * @param {number} request.timeout - Positive timeout in milliseconds.
   * @param {number} request.maxTokens - Positive output token limit.
   * @returns {Promise<unknown>} Parsed JSON content without business validation.
   */
  async completeJson({ systemPrompt, userPrompt, model, timeout, maxTokens }) {
    this.validateRequest(systemPrompt, userPrompt, model, timeout, maxTokens);
    if (!this.apiKey) {
      throw new GroqJsonClientError(GroqJsonClientError.CODE.UNAVAILABLE);
    }
    const requestBody = JSON.stringify({
      model,
      temperature: GroqConstants.TEMPERATURE,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    const controller = new AbortController();
    let timedOut = false;
    const timer = this.setTimeoutImpl(() => {
      timedOut = true;
      controller.abort();
    }, timeout);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: requestBody,
        signal: controller.signal,
      });
      await this.validateHttpResponse(response);
      return await this.parseResponse(response);
    } catch (error) {
      if (error instanceof GroqJsonClientError) {
        throw error;
      }
      if (timedOut && error?.name === "AbortError") {
        throw new GroqJsonClientError(GroqJsonClientError.CODE.TIMEOUT, {}, error);
      }
      if (error?.name === "AbortError" || error instanceof TypeError) {
        throw new GroqJsonClientError(GroqJsonClientError.CODE.UNAVAILABLE, {}, error);
      }
      throw error;
    } finally {
      this.clearTimeoutImpl(timer);
    }
  }

  /**
   * Validate safe completion parameters before any network operation.
   * @param {unknown} systemPrompt - System prompt candidate.
   * @param {unknown} userPrompt - User prompt candidate.
   * @param {unknown} model - Model candidate.
   * @param {unknown} timeout - Timeout candidate.
   * @param {unknown} maxTokens - Token limit candidate.
   * @returns {void}
   */
  validateRequest(systemPrompt, userPrompt, model, timeout, maxTokens) {
    if (typeof systemPrompt !== "string" || !systemPrompt.trim()) {
      throw new TypeError("Groq systemPrompt is required");
    }
    if (typeof userPrompt !== "string" || !userPrompt.trim()) {
      throw new TypeError("Groq userPrompt is required");
    }
    if (typeof model !== "string" || !model.trim()) {
      throw new TypeError("Groq model is required");
    }
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new TypeError("Groq timeout must be positive");
    }
    if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
      throw new TypeError("Groq maxTokens must be positive");
    }
  }

  /**
   * Classify one non-successful response and narrowly inspect recognized 413 bodies.
   * @param {object} response - Fetch response.
   * @returns {Promise<void>}
   */
  async validateHttpResponse(response) {
    if (response?.ok) {
      return;
    }
    const status = Number.isInteger(response?.status) ? response.status : null;
    if (status === HTTP_STATUS_RATE_LIMITED) {
      throw new GroqJsonClientError(
        GroqJsonClientError.CODE.RATE_LIMITED,
        { status },
      );
    }
    if (status === HTTP_STATUS_UNAUTHORIZED || status === HTTP_STATUS_FORBIDDEN) {
      throw new GroqJsonClientError(
        GroqJsonClientError.CODE.AUTHENTICATION_ERROR,
        { status },
      );
    }
    if (status === HTTP_STATUS_CONTENT_TOO_LARGE) {
      const tokenBudget = await this.parseTokenBudgetError(response);
      if (tokenBudget !== null) {
        throw new GroqJsonClientError(
          GroqJsonClientError.CODE.TOKEN_BUDGET_EXCEEDED,
          tokenBudget,
        );
      }
    }
    throw new GroqJsonClientError(GroqJsonClientError.CODE.HTTP_ERROR, { status });
  }

  /**
   * Parse only the recognized Groq single-request token-budget rejection.
   * @param {object} response - HTTP 413 response whose body remains untrusted.
   * @returns {Promise<{limitTokens: number, requestedTokens: number}|null>} Safe numeric details.
   */
  async parseTokenBudgetError(response) {
    let payload;
    try {
      payload = await response.json();
    } catch {
      return null;
    }
    const providerError = payload?.error;
    if (providerError?.type !== TOKEN_BUDGET_ERROR_TYPE
      || providerError?.code !== TOKEN_BUDGET_ERROR_CODE
      || typeof providerError?.message !== "string") {
      return null;
    }
    const limitLabels = [...providerError.message.matchAll(TOKEN_BUDGET_LIMIT_LABEL_PATTERN)];
    const requestedLabels = [
      ...providerError.message.matchAll(TOKEN_BUDGET_REQUESTED_LABEL_PATTERN),
    ];
    const matches = [...providerError.message.matchAll(TOKEN_BUDGET_PATTERN)];
    if (limitLabels.length !== 1 || requestedLabels.length !== 1
      || matches.length !== 1) {
      return null;
    }
    const limitTokens = Number(matches[0][1]);
    const requestedTokens = Number(matches[0][2]);
    if (!Number.isSafeInteger(limitTokens) || limitTokens <= 0
      || !Number.isSafeInteger(requestedTokens) || requestedTokens <= limitTokens) {
      return null;
    }
    return { limitTokens, requestedTokens };
  }

  /**
   * Parse the provider envelope and its first JSON message content.
   * @param {object} response - Successful fetch response.
   * @returns {Promise<unknown>} Parsed message JSON.
   */
  async parseResponse(response) {
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new GroqJsonClientError(GroqJsonClientError.CODE.INVALID_RESPONSE);
    }
    const content = payload?.choices?.[GroqConstants.FIRST_CHOICE_INDEX]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new GroqJsonClientError(GroqJsonClientError.CODE.INVALID_RESPONSE);
    }
    try {
      return JSON.parse(content);
    } catch {
      throw new GroqJsonClientError(GroqJsonClientError.CODE.INVALID_RESPONSE);
    }
  }
}

export { GroqJsonClient };
