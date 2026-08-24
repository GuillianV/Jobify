import { ApplicationBriefMatcherConstants } from "../constants/ApplicationBriefMatcherConstants.js";
import { ApplicationBriefContextValidationError } from "./ApplicationBriefContextValidationError.js";
import { ApplicationBriefMatcherError } from "./ApplicationBriefMatcherError.js";

const MODEL_CONTEXT_REASONS = Object.freeze([
  ApplicationBriefContextValidationError.REASON.INVALID_OFFER_REFERENCE,
  ApplicationBriefContextValidationError.REASON.FACET_NOT_IN_REQUIREMENT,
  ApplicationBriefContextValidationError.REASON.INCOMPLETE_REQUIREMENT_COVERAGE,
  ApplicationBriefContextValidationError.REASON
    .MISSING_SUPPORTED_CLAIMS_WITH_POSITIVE_EVIDENCE,
]);
const LOCAL_REGENERATION_EVENT = "application_brief_local_regeneration";
const LOCAL_REGENERATION_DECISION = Object.freeze({
  ATTEMPTED: "ATTEMPTED",
  SKIPPED: "SKIPPED",
  SUCCEEDED: "SUCCEEDED",
  FAILED_LOCAL: "FAILED_LOCAL",
  FAILED_PROVIDER: "FAILED_PROVIDER",
});
const LOCAL_REGENERATION_SKIP_REASON = Object.freeze({
  PROVIDER_CALL_CAP_REACHED: "PROVIDER_CALL_CAP_REACHED",
  REQUEST_TOKEN_BUDGET_UNAVAILABLE: "REQUEST_TOKEN_BUDGET_UNAVAILABLE",
  TOKEN_REMAINING_UNAVAILABLE: "TOKEN_REMAINING_UNAVAILABLE",
  TOKEN_HEADROOM_INSUFFICIENT: "TOKEN_HEADROOM_INSUFFICIENT",
  REQUEST_REMAINING_UNAVAILABLE: "REQUEST_REMAINING_UNAVAILABLE",
  REQUEST_HEADROOM_INSUFFICIENT: "REQUEST_HEADROOM_INSUFFICIENT",
  RETRY_AFTER_ACTIVE: "RETRY_AFTER_ACTIVE",
});
const LOCAL_REGENERATION_REASONS = Object.freeze([
  ApplicationBriefContextValidationError.REASON.FACET_NOT_IN_REQUIREMENT,
  ApplicationBriefContextValidationError.REASON.INCOMPLETE_REQUIREMENT_COVERAGE,
]);

/**
 * Builds one immutable authoritative ApplicationBrief from already loaded domain inputs.
 */
class ApplicationBriefBuilder {
  /**
   * Create the builder with projection, matching, assembly and contextual validation stages.
   * @param {object} dependencies - Builder dependencies.
   * @param {import("./ApplicationBriefInputProjector.js").ApplicationBriefInputProjector} dependencies.inputProjector - Minimal projector.
   * @param {import("./ApplicationBriefSemanticMatcher.js").ApplicationBriefSemanticMatcher} dependencies.semanticMatcher - Semantic matcher.
   * @param {import("./ApplicationBriefAssembler.js").ApplicationBriefAssembler} dependencies.assembler - Deterministic assembler.
   * @param {import("./ApplicationBriefContextValidator.js").ApplicationBriefContextValidator} dependencies.contextValidator - Structural-first contextual validator.
   * @param {{warn: (message: string) => void}} [dependencies.logger=console] - Safe retry diagnostic logger.
   */
  constructor({ inputProjector, semanticMatcher, assembler, contextValidator, logger = console }) {
    this.inputProjector = inputProjector;
    this.semanticMatcher = semanticMatcher;
    this.assembler = assembler;
    this.contextValidator = contextValidator;
    this.logger = logger;
  }

  /**
   * Run the projection, semantic, deterministic and authoritative validation pipeline.
   * @param {object} inputs - Already loaded authoritative inputs.
   * @param {import("../models/OfferAnalysis.js").OfferAnalysis} inputs.offerAnalysis - Offer analysis.
   * @param {object} inputs.offerSnapshot - Offer title context.
   * @param {object} inputs.offerIdentity - Authoritative offer identity.
   * @param {import("../models/CandidateDossier.js").CandidateDossier} inputs.candidateDossier - Candidate dossier.
   * @returns {Promise<import("../models/ApplicationBrief.js").ApplicationBrief>} Immutable validated brief.
   */
  async build({ offerAnalysis, offerSnapshot, offerIdentity, candidateDossier }) {
    const projection = this.inputProjector.project({
      offerAnalysis,
      offerSnapshot,
      candidateDossier,
    });
    const matcherResult = await this.semanticMatcher.matchWithExecution(projection);
    try {
      return this.validateSemanticOutput(matcherResult.semanticOutput, {
        offerAnalysis, offerIdentity, candidateDossier,
      });
    } catch (error) {
      if (!this.isEligibleLocalRegeneration(error)) {
        throw this.mapContextValidationError(error);
      }
      return await this.regenerateContextualOutput({
        projection,
        providerExecution: matcherResult.providerExecution,
        eligibilityReason: error.reason,
        originalError: error,
        validationContext: { offerAnalysis, offerIdentity, candidateDossier },
      });
    }
  }

  /**
   * Assemble and run the complete authoritative final validation path.
   * @param {object} semanticOutput - Strictly validated matcher output.
   * @param {object} validationContext - Authoritative assembly and validation inputs.
   * @returns {import("../models/ApplicationBrief.js").ApplicationBrief} Validated brief.
   */
  validateSemanticOutput(semanticOutput, validationContext) {
    const assembled = this.assembleSemanticOutput({
      semanticOutput,
      offerIdentity: validationContext.offerIdentity,
      candidateDossier: validationContext.candidateDossier,
    });
    return this.contextValidator.validate(assembled, validationContext);
  }

  /**
   * Perform at most one proven-headroom regeneration after an eligible contextual failure.
   * @param {object} inputs - Closed regeneration inputs.
   * @returns {Promise<import("../models/ApplicationBrief.js").ApplicationBrief>} Validated brief.
   */
  async regenerateContextualOutput(inputs) {
    const constants = ApplicationBriefMatcherConstants;
    const skipReason = this.getLocalRegenerationSkipReason(inputs.providerExecution);
    if (skipReason !== null) {
      this.logLocalRegeneration({
        decision: LOCAL_REGENERATION_DECISION.SKIPPED,
        eligibilityReason: inputs.eligibilityReason,
        skipReason,
        providerCallsMade: inputs.providerExecution?.providerCallsMade,
      });
      throw this.mapContextValidationError(inputs.originalError);
    }
    this.logLocalRegeneration({
      decision: LOCAL_REGENERATION_DECISION.ATTEMPTED,
      eligibilityReason: inputs.eligibilityReason,
      providerCallsMade: inputs.providerExecution.providerCallsMade,
    });
    let matcherResult;
    try {
      matcherResult = await this.semanticMatcher.matchWithExecution(inputs.projection, {
        startingProviderCallsMade: inputs.providerExecution.providerCallsMade,
        providerCallCap: constants.ABSOLUTE_PROVIDER_CALL_CAP,
        initialMaxTokens: inputs.providerExecution.successfulMaxTokens,
      });
    } catch (error) {
      const localFailure = error instanceof ApplicationBriefMatcherError
        && error.code === ApplicationBriefMatcherError.CODE.INVALID_OUTPUT;
      this.logLocalRegeneration({
        decision: localFailure
          ? LOCAL_REGENERATION_DECISION.FAILED_LOCAL
          : LOCAL_REGENERATION_DECISION.FAILED_PROVIDER,
        eligibilityReason: inputs.eligibilityReason,
        providerClassification: !localFailure && error instanceof ApplicationBriefMatcherError
          ? error.code
          : undefined,
      });
      throw error;
    }
    try {
      const brief = this.validateSemanticOutput(
        matcherResult.semanticOutput,
        inputs.validationContext,
      );
      this.logLocalRegeneration({
        decision: LOCAL_REGENERATION_DECISION.SUCCEEDED,
        eligibilityReason: inputs.eligibilityReason,
        providerCallsMade: matcherResult.providerExecution.providerCallsMade,
      });
      return brief;
    } catch (error) {
      this.logLocalRegeneration({
        decision: LOCAL_REGENERATION_DECISION.FAILED_LOCAL,
        eligibilityReason: inputs.eligibilityReason,
        providerCallsMade: matcherResult.providerExecution.providerCallsMade,
      });
      throw this.mapContextValidationError(error);
    }
  }

  /**
   * Identify whether one authoritative contextual reason is in the initial closed whitelist.
   * @param {Error} error - Initial local validation failure.
   * @returns {boolean} Whether one regeneration may be evaluated.
   */
  isEligibleLocalRegeneration(error) {
    return error instanceof ApplicationBriefContextValidationError
      && LOCAL_REGENERATION_REASONS.includes(error.reason)
      && ApplicationBriefMatcherConstants.LOCAL_REGENERATION_MAX === 1;
  }

  /**
   * Evaluate the closed proven-headroom gate without estimating missing metadata.
   * @param {object} providerExecution - First successful matcher execution metadata.
   * @returns {string|null} Closed skip reason or null when every gate passes.
   */
  getLocalRegenerationSkipReason(providerExecution) {
    const constants = ApplicationBriefMatcherConstants;
    if (!Number.isSafeInteger(providerExecution?.providerCallsMade)
      || providerExecution.providerCallsMade < 0
      || providerExecution.providerCallsMade >= constants.ABSOLUTE_PROVIDER_CALL_CAP) {
      return LOCAL_REGENERATION_SKIP_REASON.PROVIDER_CALL_CAP_REACHED;
    }
    if (!Number.isSafeInteger(providerExecution.successfulMaxTokens)
      || providerExecution.successfulMaxTokens <= 0
      || !Number.isSafeInteger(providerExecution.successfulRequestTokenBudget)
      || providerExecution.successfulRequestTokenBudget <= 0) {
      return LOCAL_REGENERATION_SKIP_REASON.REQUEST_TOKEN_BUDGET_UNAVAILABLE;
    }
    if (!Number.isSafeInteger(providerExecution.rateLimitTokenRemaining)
      || providerExecution.rateLimitTokenRemaining < 0) {
      return LOCAL_REGENERATION_SKIP_REASON.TOKEN_REMAINING_UNAVAILABLE;
    }
    if (providerExecution.rateLimitTokenRemaining
      < providerExecution.successfulRequestTokenBudget) {
      return LOCAL_REGENERATION_SKIP_REASON.TOKEN_HEADROOM_INSUFFICIENT;
    }
    if (!Number.isSafeInteger(providerExecution.rateLimitRequestRemaining)
      || providerExecution.rateLimitRequestRemaining < 0) {
      return LOCAL_REGENERATION_SKIP_REASON.REQUEST_REMAINING_UNAVAILABLE;
    }
    if (providerExecution.rateLimitRequestRemaining < 1) {
      return LOCAL_REGENERATION_SKIP_REASON.REQUEST_HEADROOM_INSUFFICIENT;
    }
    if (providerExecution.retryAfterMs !== undefined
      && providerExecution.retryAfterMs !== 0) {
      return LOCAL_REGENERATION_SKIP_REASON.RETRY_AFTER_ACTIVE;
    }
    return null;
  }

  /**
   * Emit one closed non-fatal local-regeneration decision event.
   * @param {object} details - Closed diagnostic fields.
   * @returns {void}
   */
  logLocalRegeneration(details) {
    try {
      const event = {
        event: LOCAL_REGENERATION_EVENT,
        decision: details.decision,
        eligibilityReason: details.eligibilityReason,
        providerCallCap: ApplicationBriefMatcherConstants.ABSOLUTE_PROVIDER_CALL_CAP,
      };
      if (details.skipReason !== undefined) {
        event.skipReason = details.skipReason;
      }
      if (Number.isSafeInteger(details.providerCallsMade)
        && details.providerCallsMade >= 0) {
        event.providerCallsMade = details.providerCallsMade;
      }
      if (Object.values(ApplicationBriefMatcherError.CODE)
        .includes(details.providerClassification)) {
        event.providerClassification = details.providerClassification;
      }
      this.logger.warn(JSON.stringify(event));
    } catch {
      return;
    }
  }

  /**
   * Assemble semantic output and map only a selected nonexistent evidence reference.
   * @param {object} inputs - Assembly inputs.
   * @returns {object} Complete plain brief candidate.
   */
  assembleSemanticOutput(inputs) {
    try {
      return this.assembler.assemble(inputs);
    } catch (error) {
      if (error instanceof ApplicationBriefContextValidationError
        && error.reason
          === ApplicationBriefContextValidationError.REASON.INVALID_EVIDENCE_REFERENCE) {
        throw this.createInvalidContextualOutput(error);
      }
      throw error;
    }
  }

  /**
   * Map only closed context reasons causally attributable to semantic decisions.
   * @param {Error} error - Final contextual validation failure.
   * @returns {Error} Safe mapped or original failure.
   */
  mapContextValidationError(error) {
    if (error instanceof ApplicationBriefContextValidationError
      && MODEL_CONTEXT_REASONS.includes(error.reason)) {
      return this.createInvalidContextualOutput(error);
    }
    return error;
  }

  /**
   * Create one stable contextual model-output failure with a safe internal cause.
   * @param {Error} cause - Closed contextual cause.
   * @returns {ApplicationBriefMatcherError} Stable matcher error.
   */
  createInvalidContextualOutput(cause) {
    return new ApplicationBriefMatcherError(
      ApplicationBriefMatcherError.CODE.INVALID_OUTPUT,
      ApplicationBriefMatcherError.REASON.INVALID_CONTEXTUAL_OUTPUT,
      cause,
    );
  }
}

export { ApplicationBriefBuilder };
