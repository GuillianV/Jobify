import { AppConfig } from "../../src/config/AppConfig.js";
import { FranceTravailConnector } from "../../src/connectors/FranceTravailConnector.js";
import { SearchCriteria } from "../../src/models/SearchCriteria.js";
import { FranceTravailDetailAudit } from "./FranceTravailDetailAudit.js";
import { FranceTravailDetailAuditConfig } from "./FranceTravailDetailAuditConfig.js";

const VALIDATION_FAILURE_PREFIX = "Argument validation failed:";
const MISSING_CONFIGURATION_MESSAGE = "France Travail credentials are required in the process environment";
const AUDIT_FAILURE_MESSAGE = "France Travail detail audit failed without exposing request details";

/**
 * Run the France Travail detail audit command-line entry point.
 * @returns {Promise<void>} Resolves when execution finishes.
 */
async function main() {
  let options;
  try {
    options = FranceTravailDetailAuditConfig.parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`${VALIDATION_FAILURE_PREFIX} ${error.message}`);
    console.error(FranceTravailDetailAuditConfig.USAGE);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    console.log(FranceTravailDetailAuditConfig.USAGE);
    return;
  }
  const applicationConfig = new AppConfig(process.env);
  const connector = new FranceTravailConnector(applicationConfig.franceTravail);
  if (!connector.isConfigured()) {
    console.error(MISSING_CONFIGURATION_MESSAGE);
    process.exitCode = 1;
    return;
  }
  const criteria = new SearchCriteria({
    keywords: options.keywords,
    communeInsee: options.communeInsee,
    distanceKm: options.distanceKm,
  });
  const audit = new FranceTravailDetailAudit({
    connector,
    criteria,
    maximumDetails: options.maximumDetails,
    outputPath: options.outputPath,
    fetchImplementation: globalThis.fetch,
  });
  try {
    await audit.run();
    console.log(`France Travail detail report written to ${options.outputPath}`);
  } catch {
    console.error(AUDIT_FAILURE_MESSAGE);
    process.exitCode = 1;
  }
}

await main();
