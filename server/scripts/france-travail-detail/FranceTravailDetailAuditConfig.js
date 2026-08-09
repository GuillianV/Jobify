import path from "node:path";

const KEYWORDS_ARGUMENT = "--keywords";
const COMMUNE_ARGUMENT = "--commune-insee";
const DISTANCE_ARGUMENT = "--distance-km";
const MAXIMUM_DETAILS_ARGUMENT = "--max-details";
const OUTPUT_ARGUMENT = "--output";
const HELP_ARGUMENT = "--help";
const HELP_SHORT_ARGUMENT = "-h";

/**
 * Parse and validate command-line configuration for the France Travail detail audit.
 */
class FranceTravailDetailAuditConfig {
  static DEFAULT_MAXIMUM_DETAILS = 20;

  static MAXIMUM_DETAILS_LIMIT = 20;

  static DEFAULT_DISTANCE_KM = 10;

  static EXCERPT_LENGTH = 160;

  static HASH_ALGORITHM = "sha256";

  static HASH_ENCODING = "hex";

  static REPORT_INDENTATION = 2;

  static SCHEMA_VERSION = 1;

  static USAGE = "Usage: node --env-file=server/.env server/scripts/france-travail-detail/runFranceTravailDetailAudit.js --keywords <text> [--commune-insee <code>] [--distance-km <integer>] [--max-details <1-20>] --output <path>";

  /**
   * Parse supported command-line arguments.
   * @param {string[]} argumentsList - Arguments excluding the executable and script path.
   * @returns {object} Validated audit options.
   */
  static parseArguments(argumentsList) {
    if (argumentsList.includes(HELP_ARGUMENT) || argumentsList.includes(HELP_SHORT_ARGUMENT)) {
      return { help: true };
    }
    const supportedArguments = new Set([
      KEYWORDS_ARGUMENT,
      COMMUNE_ARGUMENT,
      DISTANCE_ARGUMENT,
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
    const distanceKm = FranceTravailDetailAuditConfig.parsePositiveInteger(
      values.get(DISTANCE_ARGUMENT),
      DISTANCE_ARGUMENT,
      FranceTravailDetailAuditConfig.DEFAULT_DISTANCE_KM,
    );
    const maximumDetails = FranceTravailDetailAuditConfig.parsePositiveInteger(
      values.get(MAXIMUM_DETAILS_ARGUMENT),
      MAXIMUM_DETAILS_ARGUMENT,
      FranceTravailDetailAuditConfig.DEFAULT_MAXIMUM_DETAILS,
    );
    if (maximumDetails > FranceTravailDetailAuditConfig.MAXIMUM_DETAILS_LIMIT) {
      throw new Error(`${MAXIMUM_DETAILS_ARGUMENT} cannot exceed ${FranceTravailDetailAuditConfig.MAXIMUM_DETAILS_LIMIT}`);
    }
    return {
      help: false,
      keywords,
      communeInsee: values.get(COMMUNE_ARGUMENT)?.trim() || null,
      distanceKm,
      maximumDetails,
      outputPath: path.resolve(output),
    };
  }

  /**
   * Parse an optional positive integer argument.
   * @param {string|undefined} value - Raw argument value.
   * @param {string} argumentName - Argument label used in validation errors.
   * @param {number} defaultValue - Value returned when the argument is absent.
   * @returns {number} Parsed positive integer.
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

export { FranceTravailDetailAuditConfig };
