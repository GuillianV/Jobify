const path = require("path");

const KEYWORDS_ARGUMENT = "--keywords";
const LOCATION_ARGUMENT = "--location";
const MAXIMUM_DETAILS_ARGUMENT = "--max-details";
const OUTPUT_ARGUMENT = "--output";
const HELP_ARGUMENT = "--help";
const HELP_SHORT_ARGUMENT = "-h";

/**
 * Constants and command-line validation for the isolated HelloWork audit.
 */
class HelloWorkAuditConfig {
  static ALLOWED_ORIGIN = "https://www.hellowork.com";

  static ALLOWED_PROTOCOL = "https:";

  static ALLOWED_HOSTNAME = "www.hellowork.com";

  static SEARCH_PATH = "/fr-fr/emploi/recherche.html";

  static KEYWORDS_PARAMETER = "k";

  static LOCATION_PARAMETER = "l";

  static DEFAULT_MAXIMUM_DETAILS = 10;

  static MAXIMUM_DETAILS_LIMIT = 10;

  static LOAD_TIMEOUT_MS = 20000;

  static EXTRACTION_TIMEOUT_MS = 5000;

  static WINDOW_WIDTH = 1280;

  static WINDOW_HEIGHT = 800;

  static EXCERPT_LENGTH = 160;

  static EXCERPT_PORTION_COUNT = 2;

  static HASH_ALGORITHM = "sha256";

  static HASH_ENCODING = "hex";

  static REPORT_INDENTATION = 2;

  static SCHEMA_VERSION = 1;

  static MILLISECONDS_PER_DAY = 86400000;

  static CLI_ARGUMENT_OFFSET = 2;

  static SESSION_PREFIX = "jobify-hellowork-audit-";

  static SOURCE = "hellowork";

  static USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    + "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  static USAGE = "Usage: electron desktop/electron/audits/hellowork/runHelloWorkAudit.cjs --keywords <text> [--location <text>] [--max-details <1-10>] --output <path>";

  /**
   * Parse supported command-line arguments.
   * @param {string[]} argumentsList - Arguments excluding executable and entry path.
   * @returns {object} Validated audit options.
   */
  static parseArguments(argumentsList) {
    if (argumentsList.includes(HELP_ARGUMENT) || argumentsList.includes(HELP_SHORT_ARGUMENT)) {
      return { help: true };
    }
    const supportedArguments = new Set([
      KEYWORDS_ARGUMENT,
      LOCATION_ARGUMENT,
      MAXIMUM_DETAILS_ARGUMENT,
      OUTPUT_ARGUMENT,
    ]);
    const values = new Map();
    for (let index = 0; index < argumentsList.length; index += 1) {
      const argument = argumentsList[index];
      if (!supportedArguments.has(argument)) {
        throw new Error("An unsupported argument was provided");
      }
      if (values.has(argument)) {
        throw new Error(`Argument provided more than once: ${argument}`);
      }
      const value = argumentsList[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for argument: ${argument}`);
      }
      values.set(argument, value);
      index += 1;
    }
    const keywords = values.get(KEYWORDS_ARGUMENT)?.trim();
    const output = values.get(OUTPUT_ARGUMENT)?.trim();
    if (!keywords) {
      throw new Error(`${KEYWORDS_ARGUMENT} is required and cannot be empty`);
    }
    if (!output) {
      throw new Error(`${OUTPUT_ARGUMENT} is required and cannot be empty`);
    }
    const maximumDetails = HelloWorkAuditConfig.parsePositiveInteger(
      values.get(MAXIMUM_DETAILS_ARGUMENT),
      MAXIMUM_DETAILS_ARGUMENT,
      HelloWorkAuditConfig.DEFAULT_MAXIMUM_DETAILS,
    );
    if (maximumDetails > HelloWorkAuditConfig.MAXIMUM_DETAILS_LIMIT) {
      throw new Error(`${MAXIMUM_DETAILS_ARGUMENT} cannot exceed ${HelloWorkAuditConfig.MAXIMUM_DETAILS_LIMIT}`);
    }
    return {
      help: false,
      keywords,
      location: values.get(LOCATION_ARGUMENT)?.trim() || null,
      maximumDetails,
      outputPath: path.resolve(output),
    };
  }

  /**
   * Parse an optional positive integer.
   * @param {string|undefined} value - Raw value.
   * @param {string} argumentName - Argument name.
   * @param {number} defaultValue - Default value.
   * @returns {number} Parsed integer.
   */
  static parsePositiveInteger(value, argumentName, defaultValue) {
    if (value === undefined) {
      return defaultValue;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`${argumentName} must be a positive integer`);
    }
    return parsed;
  }
}

module.exports = { HelloWorkAuditConfig };
