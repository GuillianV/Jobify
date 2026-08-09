import { CareerjetConnector } from "../../src/connectors/CareerjetConnector.js";
import { SearchCriteria } from "../../src/models/SearchCriteria.js";
import { CareerjetFragmentSizeAudit } from "./CareerjetFragmentSizeAudit.js";
import { CareerjetFragmentSizeAuditConfig } from "./CareerjetFragmentSizeAuditConfig.js";

const MISSING_CONFIGURATION_MESSAGE = "CAREERJET_AFFID is required in the process environment";
const VALIDATION_FAILURE_PREFIX = "Argument validation failed:";
const AUDIT_FAILURE_MESSAGE = "Careerjet fragment-size audit failed without exposing request details";

/**
 * Run the command-line entry point without exposing credentials or request URLs.
 * @returns {Promise<void>} Resolves when execution finishes.
 */
async function main() {
  let options;
  try {
    options = CareerjetFragmentSizeAuditConfig.parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`${VALIDATION_FAILURE_PREFIX} ${error.message}`);
    console.error(CareerjetFragmentSizeAuditConfig.USAGE);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    console.log(CareerjetFragmentSizeAuditConfig.USAGE);
    return;
  }
  const affiliateId = process.env.CAREERJET_AFFID ?? "";
  if (!affiliateId) {
    console.error(MISSING_CONFIGURATION_MESSAGE);
    process.exitCode = 1;
    return;
  }
  const connector = new CareerjetConnector({ affid: affiliateId });
  const criteria = new SearchCriteria({
    keywords: options.keywords,
    location: options.location,
  });
  const audit = new CareerjetFragmentSizeAudit({
    connector,
    criteria,
    outputPath: options.outputPath,
    affiliateId,
    fetchImplementation: globalThis.fetch,
  });
  try {
    await audit.run();
    console.log(`Careerjet fragment-size report written to ${options.outputPath}`);
  } catch {
    console.error(AUDIT_FAILURE_MESSAGE);
    process.exitCode = 1;
  }
}

await main();
