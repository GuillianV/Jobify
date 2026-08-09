const { app } = require("electron");
const { HelloWorkScraper } = require("../../scrapers/HelloWorkScraper.cjs");
const { HelloWorkAuditConfig } = require("./HelloWorkAuditConfig.cjs");
const { HelloWorkUrlPolicy } = require("./HelloWorkUrlPolicy.cjs");
const { HelloWorkJsonLdAnalyzer } = require("./HelloWorkJsonLdAnalyzer.cjs");
const { HelloWorkAudit } = require("./HelloWorkAudit.cjs");

const VALIDATION_FAILURE_PREFIX = "Argument validation failed:";
const AUDIT_FAILURE_MESSAGE = "HelloWork audit failed without exposing navigation details";

/**
 * Keep the audit process alive while sequential hidden windows are replaced.
 * @returns {undefined} No lifecycle action is taken until the explicit final quit.
 */
function keepAuditAliveBetweenWindows() {
  return undefined;
}

/**
 * Run the isolated HelloWork audit under the Electron runtime.
 * @returns {Promise<void>} Resolves after writing the report or recording failure.
 */
async function main() {
  let options;
  try {
    options = HelloWorkAuditConfig.parseArguments(
      process.argv.slice(HelloWorkAuditConfig.CLI_ARGUMENT_OFFSET),
    );
  } catch (error) {
    console.error(`${VALIDATION_FAILURE_PREFIX} ${error.message}`);
    console.error(HelloWorkAuditConfig.USAGE);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    console.log(HelloWorkAuditConfig.USAGE);
    return;
  }
  await app.whenReady();
  const textNormalizerModule = await import(
    "../../../../server/src/normalization/TextNormalizer.js"
  );
  const { TextNormalizer } = textNormalizerModule;
  const helloWorkScraper = new HelloWorkScraper();
  const analyzer = new HelloWorkJsonLdAnalyzer({
    productionCleaner: (value) => {
      return helloWorkScraper.cleanDescription(value);
    },
    htmlToPlainText: (value) => {
      return TextNormalizer.htmlToPlainText(value);
    },
    normalizeText: (value) => {
      return TextNormalizer.normalize(value);
    },
    containsHtmlLike: (value) => {
      return TextNormalizer.containsHtmlOrEntity(value);
    },
  });
  const audit = new HelloWorkAudit({
    options,
    urlPolicy: new HelloWorkUrlPolicy(),
    jsonLdAnalyzer: analyzer,
    helloWorkScraper,
  });
  try {
    await audit.run();
    console.log(`HelloWork audit report written to ${options.outputPath}`);
  } catch {
    console.error(AUDIT_FAILURE_MESSAGE);
    process.exitCode = 1;
  }
}

app.on("window-all-closed", keepAuditAliveBetweenWindows);

main()
  .catch(() => {
    console.error(AUDIT_FAILURE_MESSAGE);
    process.exitCode = 1;
  })
  .finally(() => {
    app.quit();
  });
