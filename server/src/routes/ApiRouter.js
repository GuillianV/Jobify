import { Router } from "express";

const OFFERS_ROUTE = "/offres";
const PROFILES_ROUTE = "/profils";
const PROFILE_BY_ID_ROUTE = "/profils/:id";

/**
 * Builds the Express router exposing the public API routes.
 */
class ApiRouter {
  /**
   * Create the router builder with its controller dependencies.
   * @param {import("../controllers/OfferController.js").OfferController} offerController - The offer controller.
   * @param {import("../controllers/ProfileController.js").ProfileController} profileController - The profile controller.
   */
  constructor(offerController, profileController) {
    this.offerController = offerController;
    this.profileController = profileController;
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
    router.get(PROFILES_ROUTE, (request, response) => {
      this.profileController.listProfiles(request, response);
    });
    router.post(PROFILES_ROUTE, (request, response) => {
      this.profileController.createProfile(request, response);
    });
    router.delete(PROFILE_BY_ID_ROUTE, (request, response) => {
      this.profileController.deleteProfile(request, response);
    });
    return router;
  }
}

export { ApiRouter };
