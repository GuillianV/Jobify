import { ApplicationBriefContextValidationError } from "./ApplicationBriefContextValidationError.js";
import { ApplicationBriefMatcherError } from "./ApplicationBriefMatcherError.js";

const MODEL_CONTEXT_REASONS = Object.freeze([
  ApplicationBriefContextValidationError.REASON.INVALID_OFFER_REFERENCE,
  ApplicationBriefContextValidationError.REASON.FACET_NOT_IN_REQUIREMENT,
  ApplicationBriefContextValidationError.REASON.INCOMPLETE_REQUIREMENT_COVERAGE,
  ApplicationBriefContextValidationError.REASON
    .MISSING_SUPPORTED_CLAIMS_WITH_POSITIVE_EVIDENCE,
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
   */
  constructor({ inputProjector, semanticMatcher, assembler, contextValidator }) {
    this.inputProjector = inputProjector;
    this.semanticMatcher = semanticMatcher;
    this.assembler = assembler;
    this.contextValidator = contextValidator;
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
    const assembled = this.assembleSemanticOutput({
      semanticOutput: matcherResult.semanticOutput,
      offerIdentity,
      candidateDossier,
    });
    try {
      return this.contextValidator.validate(assembled, {
        offerAnalysis,
        offerIdentity,
        candidateDossier,
      });
    } catch (error) {
      throw this.mapContextValidationError(error);
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
