import path from "node:path";

const CONTROL_LABEL = "control";
const KEYWORDS_ARGUMENT = "--keywords";
const LOCATION_ARGUMENT = "--location";
const OUTPUT_ARGUMENT = "--output";
const HELP_ARGUMENT = "--help";
const HELP_SHORT_ARGUMENT = "-h";

/**
 * Configuration and command-line validation for the Careerjet fragment-size audit.
 */
class CareerjetFragmentSizeAuditConfig {
  static FRAGMENT_VARIANTS = Object.freeze([null, 120, 500, 1000, 3000, 5000, 10000]);

  static NUMERIC_FRAGMENT_VARIANTS = Object.freeze([120, 500, 1000, 3000, 5000, 10000]);

  static EXCERPT_LENGTH = 160;

  static MAXIMUM_COVERAGE_RATIO = 0.95;

  static HASH_ALGORITHM = "sha256";

  static HASH_ENCODING = "hex";

  static REPORT_INDENTATION = 2;

  static CONTROL_LABEL = CONTROL_LABEL;

  static USAGE = "Usage: node --env-file=server/.env server/scripts/careerjet-fragment-size/runCareerjetFragmentSizeAudit.js --keywords <text> [--location <text>] --output <path>";

  /**
   * Parse and validate supported command-line arguments.
   * @param {string[]} argumentsList - Arguments excluding the Node executable and script path.
   * @returns {{help: boolean, keywords?: string, location?: string|null, outputPath?: string}} Parsed values.
   */
  static parseArguments(argumentsList) {
    if (argumentsList.includes(HELP_ARGUMENT) || argumentsList.includes(HELP_SHORT_ARGUMENT)) {
      return { help: true };
    }
    const supportedArguments = new Set([
      KEYWORDS_ARGUMENT,
      LOCATION_ARGUMENT,
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
    return {
      help: false,
      keywords,
      location: values.get(LOCATION_ARGUMENT)?.trim() || null,
      outputPath: path.resolve(output),
    };
  }

  /**
   * Return the stable report label for a fragment-size variant.
   * @param {number|null} fragmentSize - Experimental fragment size, or null for control.
   * @returns {string} The report label.
   */
  static getVariantLabel(fragmentSize) {
    if (fragmentSize === null) {
      return CONTROL_LABEL;
    }
    return String(fragmentSize);
  }
}

export { CareerjetFragmentSizeAuditConfig };
