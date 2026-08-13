import { HttpStatus } from "../constants/HttpStatus.js";
import { CandidateDossierServiceError } from "../services/CandidateDossierServiceError.js";
import { CandidateDossierValidationError } from "../services/CandidateDossierValidationError.js";

const PUBLIC_ERROR = Object.freeze({
  INVALID_DOSSIER: "Candidate dossier is invalid",
  INTERNAL_SERVER_ERROR: "Internal server error",
});

/**
 * Controller exposing the singleton candidate dossier API resource.
 */
class CandidateDossierController {
  /**
   * Create the controller with its service and JSON view dependencies.
   * @param {import("../services/CandidateDossierService.js").CandidateDossierService} candidateDossierService - Dossier orchestrator.
   * @param {import("../views/JsonView.js").JsonView} view - JSON response renderer.
   */
  constructor(candidateDossierService, view) {
    this.candidateDossierService = candidateDossierService;
    this.view = view;
  }

  /**
   * Return the singleton dossier or its official empty representation.
   * @param {import("express").Request} request - Incoming request.
   * @param {import("express").Response} response - Outgoing response.
   * @returns {void}
   */
  getDossier(request, response) {
    try {
      const result = this.candidateDossierService.get();
      this.view.renderSuccess(response, this.toApiJson(result));
    } catch (error) {
      this.renderError(response, error);
    }
  }

  /**
   * Fully replace the singleton dossier with one validated request body.
   * @param {import("express").Request} request - Incoming request.
   * @param {import("express").Response} response - Outgoing response.
   * @returns {void}
   */
  saveDossier(request, response) {
    try {
      const result = this.candidateDossierService.save(request.body);
      this.view.renderSuccess(response, this.toApiJson(result));
    } catch (error) {
      this.renderError(response, error);
    }
  }

  /**
   * Project one service result through the exact public response whitelist.
   * @param {object} result - Validated service result.
   * @returns {object} Public dossier and persistence timestamp.
   */
  toApiJson(result) {
    return {
      dossier: result.dossier.toJson(),
      updatedAt: result.updatedAt,
    };
  }

  /**
   * Map one failure to a closed sanitized HTTP response.
   * @param {import("express").Response} response - Outgoing response.
   * @param {unknown} error - Controller boundary failure.
   * @returns {void}
   */
  renderError(response, error) {
    if (error instanceof CandidateDossierValidationError) {
      this.view.renderError(
        response,
        HttpStatus.UNPROCESSABLE_ENTITY,
        PUBLIC_ERROR.INVALID_DOSSIER,
        { code: "INVALID_CANDIDATE_DOSSIER" },
      );
      return;
    }
    if (error instanceof CandidateDossierServiceError
      && error.code === CandidateDossierServiceError.CODE.PERSISTENCE_ERROR) {
      this.view.renderError(
        response,
        HttpStatus.INTERNAL_SERVER_ERROR,
        PUBLIC_ERROR.INTERNAL_SERVER_ERROR,
        { code: "CANDIDATE_DOSSIER_PERSISTENCE_ERROR" },
      );
      return;
    }
    this.view.renderError(
      response,
      HttpStatus.INTERNAL_SERVER_ERROR,
      PUBLIC_ERROR.INTERNAL_SERVER_ERROR,
      { code: "INTERNAL_SERVER_ERROR" },
    );
  }
}

export { CandidateDossierController };
