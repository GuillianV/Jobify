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
   * @param {import("./ApplicationBriefIntegritySigner.js").ApplicationBriefIntegritySigner} dependencies.applicationBriefIntegritySigner - Shared process signer.
   */
  constructor({
    offerAnalysisService,
    candidateDossierService,
    applicationBriefBuilder,
    applicationBriefIntegritySigner,
  }) {
    this.offerAnalysisService = offerAnalysisService;
    this.candidateDossierService = candidateDossierService;
    this.applicationBriefBuilder = applicationBriefBuilder;
    this.applicationBriefIntegritySigner = applicationBriefIntegritySigner;
  }

  /**
   * Generate one brief for an offer using only authoritative server-side inputs.
   * @param {number} offerId - Requested persisted offer identifier.
   * @returns {Promise<{brief: object, generationToken: string}>} Signed brief envelope.
   */
  async generateForOffer(offerId) {
    const analysisResult = await this.offerAnalysisService.analyze(offerId);
    const candidateResult = this.candidateDossierService.get();
    const identity = analysisResult.identity;
    const applicationBrief = await this.applicationBriefBuilder.build({
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
    const brief = applicationBrief.toJson();
    const generationToken = this.applicationBriefIntegritySigner.sign(brief);
    return { brief, generationToken };
  }
}

export { ApplicationBriefService };
