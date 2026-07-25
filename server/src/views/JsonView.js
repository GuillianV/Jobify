import { HttpStatus } from "../constants/HttpStatus.js";

/**
 * View responsible for rendering JSON HTTP responses.
 */
class JsonView {
  /**
   * Render a successful JSON response.
   * @param {import("express").Response} response - The Express response.
   * @param {object} payload - The data to serialize as JSON.
   * @returns {void}
   */
  renderSuccess(response, payload) {
    response.status(HttpStatus.OK).json(payload);
  }

  /**
   * Render an error JSON response.
   * @param {import("express").Response} response - The Express response.
   * @param {number} statusCode - The HTTP status code to send.
   * @param {string} errorMessage - The error message to expose.
   * @returns {void}
   */
  renderError(response, statusCode, errorMessage) {
    response.status(statusCode).json({ error: errorMessage });
  }
}

export { JsonView };
