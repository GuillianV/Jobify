/**
 * Orchestrates one on-demand ApplicationBrief from authoritative server-side inputs.
 */
class ApplicationBriefService {
  /**
   * Create the service from the existing analysis, candidate, and builder workflows.
   * @param {object} dependencies - Service dependencies.
   * @param {import("./OfferAnalysisService.js").OfferAnalysisService} dependencies.offerAnalysisService - Cached offer analysis workflow.
   * @param {import("./CandidateDossierService.js").CandidateDossierService} dependencies.candidateDossierService - Authoritative candidate workflow.
   * @param {import("./ApplicationBriefBuilder.js").ApplicationBriefBuilder} dependencies.applicationBriefBuilder - Brief builder.
   */
  constructor({ offerAnalysisService, candidateDossierService, applicationBriefBuilder }) {
    this.offerAnalysisService = offerAnalysisService;
    this.candidateDossierService = candidateDossierService;
    this.applicationBriefBuilder = applicationBriefBuilder;
  }

  /**
   * Generate one brief for an offer using only authoritative server-side inputs.
   * @param {number} offerId - Requested persisted offer identifier.
   * @returns {Promise<import("../models/ApplicationBrief.js").ApplicationBrief>} Generated brief.
   */
  async generateForOffer(offerId) {
    const analysisResult = await this.offerAnalysisService.analyze(offerId);
    const candidateResult = this.candidateDossierService.get();
    const identity = analysisResult.identity;
    return await this.applicationBriefBuilder.build({
      offerAnalysis: analysisResult.analysis,
      offerSnapshot: analysisResult.offerSnapshot,
      offerIdentity: {
        offerId: identity.offerId,
        analysisFingerprint: identity.cacheKey,
        analysisSchemaVersion: identity.schemaVersion,
        analyzerPolicyVersion: identity.policyVersion,
      },
      candidateDossier: candidateResult.dossier,
    });
  }
}

export { ApplicationBriefService };
