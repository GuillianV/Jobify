import express from "express";
import cors from "cors";

const API_BASE_PATH = "/api";

/**
 * Wires the Express application together and owns the HTTP server lifecycle.
 */
class Application {
  /**
   * Create the application from its configuration and router builder.
   * @param {import("./config/AppConfig.js").AppConfig} config - The resolved configuration.
   * @param {import("./routes/ApiRouter.js").ApiRouter} apiRouter - The API router builder.
   */
  constructor(config, apiRouter) {
    this.config = config;
    this.apiRouter = apiRouter;
    this.expressApp = express();
  }

  /**
   * Register the global middleware and mount the API routes.
   * @returns {void}
   */
  configure() {
    this.expressApp.use(cors());
    this.expressApp.use(express.json());
    this.expressApp.use(API_BASE_PATH, this.apiRouter.build());
  }

  /**
   * Configure the application and start listening for HTTP connections.
   * @returns {void}
   */
  start() {
    this.configure();
    this.expressApp.listen(this.config.port, () => {
      const address = this.config.getBaseUrl();
      console.log(`Jobify server started on ${address}`);
    });
  }
}

export { Application };
