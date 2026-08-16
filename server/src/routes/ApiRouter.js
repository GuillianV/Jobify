import { Router } from "express";

const OFFERS_ROUTE = "/offres";
const OFFER_CONTENT_ROUTE = "/offres/:id/contenu";
const OFFER_PREPARE_ROUTE = "/offres/:id/prepare";
const OFFER_ANALYSE_ROUTE = "/offres/:id/analyse";
const OFFER_USER_CONTENT_ROUTE = "/offres/:id/contenu-utilisateur";
const PROFILES_ROUTE = "/profils";
const PROFILE_BY_ID_ROUTE = "/profils/:id";
const CANDIDATE_DOSSIER_ROUTE = "/dossier-candidat";
const APPLICATION_BRIEF_ROUTE = "/offres/:id/application-brief";

/**
 * Builds the Express router exposing the public API routes.
 */
class ApiRouter {
  /**
   * Create the router builder with its controller dependencies.
   * @param {import("../controllers/OfferController.js").OfferController} offerController - The offer controller.
   * @param {import("../controllers/ProfileController.js").ProfileController} profileController - The profile controller.
   * @param {import("../controllers/CandidateDossierController.js").CandidateDossierController} candidateDossierController - Singleton dossier controller.
   * @param {import("../controllers/ApplicationBriefController.js").ApplicationBriefController} applicationBriefController - On-demand brief controller.
   */
  constructor(
    offerController,
    profileController,
    candidateDossierController,
    applicationBriefController,
  ) {
    this.offerController = offerController;
    this.profileController = profileController;
    this.candidateDossierController = candidateDossierController;
    this.applicationBriefController = applicationBriefController;
  }

  /**
   * Build and return the configured Express router.
   * @returns {import("express").Router} The configured router.
   */
  build() {
    const router = Router();
    const handleSearch = (request, response) => {
      this.offerController.searchOffers(request, response);
    };
    router.get(OFFERS_ROUTE, handleSearch);
    router.post(OFFERS_ROUTE, handleSearch);
    router.patch(OFFER_CONTENT_ROUTE, (request, response) => {
      this.offerController.enrichOfferContent(request, response);
    });
    router.post(OFFER_PREPARE_ROUTE, (request, response) => {
      this.offerController.prepareOffer(request, response);
    });
    router.post(OFFER_ANALYSE_ROUTE, (request, response) => {
      this.offerController.analyseOffer(request, response);
    });
    router.put(OFFER_USER_CONTENT_ROUTE, (request, response) => {
      this.offerController.replaceUserContent(request, response);
    });
    router.get(PROFILES_ROUTE, (request, response) => {
      this.profileController.listProfiles(request, response);
    });
    router.post(PROFILES_ROUTE, (request, response) => {
      this.profileController.createProfile(request, response);
    });
    router.delete(PROFILE_BY_ID_ROUTE, (request, response) => {
      this.profileController.deleteProfile(request, response);
    });
    router.get(CANDIDATE_DOSSIER_ROUTE, (request, response) => {
      this.candidateDossierController.getDossier(request, response);
    });
    router.put(CANDIDATE_DOSSIER_ROUTE, (request, response) => {
      this.candidateDossierController.saveDossier(request, response);
    });
    router.post(APPLICATION_BRIEF_ROUTE, (request, response) => {
      this.applicationBriefController.generateForOffer(request, response);
    });
    return router;
  }
}

export { ApiRouter };
