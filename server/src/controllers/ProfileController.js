import { SearchProfile } from "../models/SearchProfile.js";
import { SearchDefaults } from "../constants/SearchDefaults.js";
import { HttpStatus } from "../constants/HttpStatus.js";
import { NumberConstants } from "../constants/NumberConstants.js";

/**
 * Controller exposing the saved search profiles resource of the API.
 */
class ProfileController {
  /**
   * Create the controller with its dependencies.
   * @param {import("../persistence/ProfileRepository.js").ProfileRepository} profileRepository - Profile store.
   * @param {import("../views/JsonView.js").JsonView} view - JSON view.
   */
  constructor(profileRepository, view) {
    this.profileRepository = profileRepository;
    this.view = view;
  }

  /**
   * List every saved profile.
   * @param {import("express").Request} request - The incoming request.
   * @param {import("express").Response} response - The outgoing response.
   * @returns {void}
   */
  listProfiles(request, response) {
    try {
      const profiles = this.profileRepository.list();
      this.view.renderSuccess(response, {
        profils: profiles.map((profile) => {
          return profile.toJson();
        }),
      });
    } catch (error) {
      this.view.renderError(response, HttpStatus.INTERNAL_SERVER_ERROR, error.message);
    }
  }

  /**
   * Create a saved profile from the request body.
   * @param {import("express").Request} request - The incoming request.
   * @param {import("express").Response} response - The outgoing response.
   * @returns {void}
   */
  createProfile(request, response) {
    const body = request.body ?? {};
    if (!body.label || !body.keywords) {
      this.view.renderError(response, HttpStatus.BAD_REQUEST, "label et keywords sont requis");
      return;
    }
    try {
      const profile = new SearchProfile({
        label: body.label,
        keywords: body.keywords,
        city: body.city ?? null,
        distanceKm: this.parseDistance(body.distanceKm),
      });
      const created = this.profileRepository.create(profile);
      this.view.renderSuccess(response, created.toJson());
    } catch (error) {
      this.view.renderError(response, HttpStatus.INTERNAL_SERVER_ERROR, error.message);
    }
  }

  /**
   * Delete a saved profile by its identifier.
   * @param {import("express").Request} request - The incoming request.
   * @param {import("express").Response} response - The outgoing response.
   * @returns {void}
   */
  deleteProfile(request, response) {
    const id = Number.parseInt(request.params.id, NumberConstants.DECIMAL_RADIX);
    if (Number.isNaN(id)) {
      this.view.renderError(response, HttpStatus.BAD_REQUEST, "identifiant invalide");
      return;
    }
    try {
      const deleted = this.profileRepository.remove(id);
      if (!deleted) {
        this.view.renderError(response, HttpStatus.NOT_FOUND, "profil introuvable");
        return;
      }
      this.view.renderSuccess(response, { deleted: true });
    } catch (error) {
      this.view.renderError(response, HttpStatus.INTERNAL_SERVER_ERROR, error.message);
    }
  }

  /**
   * Parse the distance value from the request, falling back to the default.
   * @param {unknown} rawDistance - The raw distance value.
   * @returns {number} The parsed distance in kilometers.
   */
  parseDistance(rawDistance) {
    const parsed = Number(rawDistance);
    if (Number.isNaN(parsed)) {
      return SearchDefaults.DEFAULT_DISTANCE_KM;
    }
    return parsed;
  }
}

export { ProfileController };
