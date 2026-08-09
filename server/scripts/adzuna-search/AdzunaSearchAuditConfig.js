import path from "node:path";

const KEYWORDS_ARGUMENT = "--keywords";
const LOCATION_ARGUMENT = "--location";
const DISTANCE_ARGUMENT = "--distance-km";
const OUTPUT_ARGUMENT = "--output";
const HELP_ARGUMENT = "--help";
const HELP_SHORT_ARGUMENT = "-h";

/**
 * Parse command-line configuration for the Adzuna search audit.
 */
class AdzunaSearchAuditConfig {
  static DEFAULT_DISTANCE_KM = 10;

  static EXCERPT_LENGTH = 160;

  static HASH_ALGORITHM = "sha256";

  static HASH_ENCODING = "hex";

  static REPORT_INDENTATION = 2;

  static SCHEMA_VERSION = 1;

  static USAGE = "Usage: node --env-file=server/.env server/scripts/adzuna-search/runAdzunaSearchAudit.js --keywords <text> [--location <text>] [--distance-km <integer>] --output <path>";

  /**
   * Parse supported command-line arguments.
   * @param {string[]} argumentsList - Arguments excluding executable and script path.
   * @returns {object} Validated audit options.
   */
  static parseArguments(argumentsList) {
    if (argumentsList.includes(HELP_ARGUMENT) || argumentsList.includes(HELP_SHORT_ARGUMENT)) {
      return { help: true };
    }
    const supportedArguments = new Set([
      KEYWORDS_ARGUMENT,
      LOCATION_ARGUMENT,
      DISTANCE_ARGUMENT,
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
    const distanceKm = AdzunaSearchAuditConfig.parsePositiveInteger(
      values.get(DISTANCE_ARGUMENT),
      DISTANCE_ARGUMENT,
      AdzunaSearchAuditConfig.DEFAULT_DISTANCE_KM,
    );
    return {
      help: false,
      keywords,
      location: values.get(LOCATION_ARGUMENT)?.trim() || null,
      distanceKm,
      outputPath: path.resolve(output),
    };
  }

  /**
   * Parse an optional positive integer.
   * @param {string|undefined} value - Raw argument value.
   * @param {string} argumentName - Argument name for validation errors.
   * @param {number} defaultValue - Default when absent.
   * @returns {number} Parsed value.
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

export { AdzunaSearchAuditConfig };
