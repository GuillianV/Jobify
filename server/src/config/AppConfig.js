import { FranceTravailConstants } from "../constants/FranceTravailConstants.js";
import { GroqConstants } from "../constants/GroqConstants.js";
import { NumberConstants } from "../constants/NumberConstants.js";

const DEFAULT_PORT = 3001;
const DEFAULT_HOST = "localhost";

/**
 * Application configuration resolved from the process environment.
 */
class AppConfig {
  /**
   * Build the configuration from environment variables, falling back to
   * sensible defaults when a value is missing.
   * @param {NodeJS.ProcessEnv} environment - The process environment.
   */
  constructor(environment) {
    const parsedPort = Number.parseInt(environment.PORT, NumberConstants.DECIMAL_RADIX);
    this.port = Number.isNaN(parsedPort) ? DEFAULT_PORT : parsedPort;
    this.host = environment.HOST ?? DEFAULT_HOST;
    this.franceTravail = {
      clientId: environment.FRANCE_TRAVAIL_CLIENT_ID ?? "",
      clientSecret: environment.FRANCE_TRAVAIL_CLIENT_SECRET ?? "",
      scope: environment.FRANCE_TRAVAIL_SCOPE ?? FranceTravailConstants.DEFAULT_SCOPE,
    };
    this.adzuna = {
      appId: environment.ADZUNA_APP_ID ?? "",
      appKey: environment.ADZUNA_APP_KEY ?? "",
    };
    this.careerjet = {
      affid: environment.CAREERJET_AFFID ?? "",
    };
    this.groq = {
      apiKey: environment.GROQ_API_KEY ?? "",
      model: environment.GROQ_MODEL ?? GroqConstants.DEFAULT_MODEL,
    };
  }

  /**
   * Return the fully qualified base address of the server.
   * @returns {string} The base URL, for example http://localhost:3001.
   */
  getBaseUrl() {
    return `http://${this.host}:${this.port}`;
  }
}

export { AppConfig };
