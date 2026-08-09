import { AppConfig } from "../../src/config/AppConfig.js";
import { AdzunaConnector } from "../../src/connectors/AdzunaConnector.js";
import { SearchCriteria } from "../../src/models/SearchCriteria.js";
import { AdzunaSearchAudit } from "./AdzunaSearchAudit.js";
import { AdzunaSearchAuditConfig } from "./AdzunaSearchAuditConfig.js";

const VALIDATION_FAILURE_PREFIX = "Argument validation failed:";
const MISSING_CONFIGURATION_MESSAGE = "Adzuna credentials are required in the process environment";
const AUDIT_FAILURE_MESSAGE = "Adzuna search audit failed without exposing request details";

/**
 * Run the Adzuna search audit command-line entry point.
 * @returns {Promise<void>} Resolves when execution finishes.
 */
async function main() {
  let options;
  try {
    options = AdzunaSearchAuditConfig.parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`${VALIDATION_FAILURE_PREFIX} ${error.message}`);
    console.error(AdzunaSearchAuditConfig.USAGE);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    console.log(AdzunaSearchAuditConfig.USAGE);
    return;
  }
  const applicationConfig = new AppConfig(process.env);
  const connector = new AdzunaConnector(applicationConfig.adzuna);
  if (!connector.isConfigured()) {
    console.error(MISSING_CONFIGURATION_MESSAGE);
    process.exitCode = 1;
    return;
  }
  const criteria = new SearchCriteria({
    keywords: options.keywords,
    location: options.location,
    distanceKm: options.distanceKm,
  });
  const audit = new AdzunaSearchAudit({
    connector,
    criteria,
    outputPath: options.outputPath,
    fetchImplementation: globalThis.fetch,
  });
  try {
    await audit.run();
    console.log(`Adzuna search report written to ${options.outputPath}`);
  } catch {
    console.error(AUDIT_FAILURE_MESSAGE);
    process.exitCode = 1;
  }
}

await main();
