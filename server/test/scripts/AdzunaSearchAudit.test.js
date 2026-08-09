import test from "node:test";
import assert from "node:assert/strict";
import { AdzunaConnector } from "../../src/connectors/AdzunaConnector.js";
import { SearchCriteria } from "../../src/models/SearchCriteria.js";
import { AdzunaSearchAudit } from "../../scripts/adzuna-search/AdzunaSearchAudit.js";
import { AdzunaSearchAuditConfig } from "../../scripts/adzuna-search/AdzunaSearchAuditConfig.js";

const HTTP_OK = 200;
const CONFIGURED_DISTANCE_KM = 15;
const NUMERIC_ID = 123;
const RESULT_COUNT = 2;
const SHORT_DESCRIPTION_LENGTH = 50;
const MEDIUM_DESCRIPTION_LENGTH = 200;
const LONG_DESCRIPTION_LENGTH = 321;
const SECRET_APP_ID = "secret-app-id";
const SECRET_APP_KEY = "secret-app-key";
const RAW_DESCRIPTION = "<p>Build APIs...</p>";
const NORMALIZED_DESCRIPTION = "Build APIs...";

test("configuration validates arguments and resolves the output path", () => {
  const options = AdzunaSearchAuditConfig.parseArguments([
    "--keywords",
    "développeur",
    "--location",
    "Paris",
    "--distance-km",
    String(CONFIGURED_DISTANCE_KM),
    "--output",
    "audit.json",
  ]);

  assert.equal(options.keywords, "développeur");
  assert.equal(options.location, "Paris");
  assert.equal(options.distanceKm, CONFIGURED_DISTANCE_KM);
  assert.match(options.outputPath, /audit\.json$/u);
  assert.throws(() => {
    AdzunaSearchAuditConfig.parseArguments([
      "--keywords",
      "développeur",
      "--distance-km",
      "0",
      "--output",
      "audit.json",
    ]);
  }, /positive integer/u);
});

test("audit captures one search safely and measures mapping, identities and collisions", async () => {
  const rawResults = [
    {
      id: NUMERIC_ID,
      title: "Developer",
      description: RAW_DESCRIPTION,
      company: { display_name: "Example", extra_code: "private-company-value" },
      location: { display_name: "Paris", area: ["France", "Paris"] },
      latitude: 48.8,
      longitude: 2.3,
      contract_type: "permanent",
      salary_min: 40000,
      salary_max: 50000,
      redirect_url: "https://jobs.example.test/apply?secret=value",
      created: "2026-08-01T10:00:00Z",
      category: { label: "IT" },
    },
    {
      id: String(NUMERIC_ID),
      title: "Developer",
      description: "Build APIs...",
      company: { display_name: "Example" },
      location: { display_name: "Paris", area: ["France", "Paris"] },
      redirect_url: "invalid redirect",
      created: "2026-08-01T10:00:00Z",
    },
  ];
  const payload = { count: 75, mean: 42.5, results: rawResults };
  let requestCount = 0;
  const fetchImplementation = async (input) => {
    requestCount += 1;
    const url = new URL(input.toString());
    assert.equal(url.origin, "https://api.adzuna.com");
    assert.equal(url.pathname, "/v1/api/jobs/fr/search/1");
    assert.equal(url.searchParams.get("app_id"), SECRET_APP_ID);
    assert.equal(url.searchParams.get("app_key"), SECRET_APP_KEY);
    return Response.json(payload);
  };
  let serializedReport = "";
  const connector = new AdzunaConnector({ appId: SECRET_APP_ID, appKey: SECRET_APP_KEY });
  const audit = new AdzunaSearchAudit({
    connector,
    criteria: new SearchCriteria({
      keywords: "développeur",
      location: "Paris",
      distanceKm: CONFIGURED_DISTANCE_KM,
    }),
    outputPath: "ignored.json",
    fetchImplementation,
    writeFileImplementation: async (outputPath, contents, encoding) => {
      assert.equal(outputPath, "ignored.json");
      assert.equal(encoding, "utf8");
      serializedReport = contents;
    },
  });

  const report = await audit.run();

  assert.equal(requestCount, 1);
  assert.equal(report.search.mappingCardinalityMatches, true);
  assert.equal(report.identitySummary.uniqueUsableRawIdCount, RESULT_COUNT);
  assert.equal(report.identitySummary.duplicatedIdCount, 0);
  assert.equal(report.identitySummary.sourceIdCoercionCollisionCount, 1);
  assert.equal(report.identitySummary.rawIdToSourceIdMatchCount, RESULT_COUNT);
  assert.equal(report.deduplication.collidingExactKeyCount, 1);
  assert.equal(report.offers[0].description.htmlLikeMarkupDetected, true);
  assert.equal(report.offers[0].description.rawEndsWithEllipsis, false);
  assert.equal(report.offers[0].description.normalizedEndsWithEllipsis, true);
  assert.equal(report.offers[0].description.normalizedHash.length > 0, true);
  assert.equal(report.offers[0].redirectUrl.host, "jobs.example.test");
  assert.equal(report.offers[1].redirectUrl.validUrl, false);
  assert.equal(report.offers[0].mapping.checks.sourceId, true);
  assert.equal(report.offers[0].mapping.checks.locationCity, true);
  assert.equal(report.mappingSummary.observedUnmappedPaths.includes("company.extra_code"), true);
  assert.equal(report.mappingSummary.observedUnmappedPaths.includes("category.label"), true);
  assert.deepEqual(report.search.observedTopLevelNumericMetadata, [
    { path: "count", value: 75 },
    { path: "mean", value: 42.5 },
  ]);
  assert.equal(serializedReport.includes(SECRET_APP_ID), false);
  assert.equal(serializedReport.includes(SECRET_APP_KEY), false);
  assert.equal(serializedReport.includes("secret=value"), false);
  assert.equal(serializedReport.includes(RAW_DESCRIPTION), false);
  assert.equal(serializedReport.includes(NORMALIZED_DESCRIPTION), false);
});

test("description excerpts always omit text and never overlap", () => {
  const audit = new AdzunaSearchAudit({
    connector: {},
    criteria: {},
    outputPath: "ignored.json",
    fetchImplementation: async () => {
      return new Response(null, { status: HTTP_OK });
    },
  });
  const descriptions = [
    "§",
    `${"a".repeat(SHORT_DESCRIPTION_LENGTH - 1)}b`,
    `${"c".repeat(MEDIUM_DESCRIPTION_LENGTH - 1)}d`,
    `${"e".repeat(LONG_DESCRIPTION_LENGTH - 1)}f`,
  ];

  for (const description of descriptions) {
    const measurement = audit.measureDescription(description);
    const { normalizedText, ...safeMeasurement } = measurement;
    const combinedExcerpts = measurement.beginning + measurement.end;
    const serializedMeasurement = JSON.stringify(safeMeasurement);

    assert.equal(normalizedText, description);
    assert.equal(combinedExcerpts.length < description.length, true);
    assert.equal(measurement.beginning.length <= AdzunaSearchAuditConfig.EXCERPT_LENGTH, true);
    assert.equal(measurement.end.length <= AdzunaSearchAuditConfig.EXCERPT_LENGTH, true);
    assert.equal(description.startsWith(measurement.beginning), true);
    assert.equal(description.endsWith(measurement.end), true);
    assert.equal(serializedMeasurement.includes(description), false);
  }
  const singleCharacter = audit.measureDescription("§");
  const emptyDescription = audit.measureDescription("");
  assert.equal(singleCharacter.beginning, "");
  assert.equal(singleCharacter.end, "");
  assert.equal(emptyDescription.beginning, "");
  assert.equal(emptyDescription.end, "");
});

test("raw identity statistics exclude missing null undefined and blank values", () => {
  const connector = new AdzunaConnector({ appId: "test", appKey: "test" });
  const audit = new AdzunaSearchAudit({
    connector,
    criteria: {},
    outputPath: "ignored.json",
    fetchImplementation: async () => {
      return new Response(null, { status: HTTP_OK });
    },
  });
  const rawResults = [
    {},
    { id: null },
    { id: undefined },
    { id: "   " },
    { id: "usable" },
    { id: "usable" },
  ];
  const canonicalOffers = rawResults.map((raw) => {
    return connector.mapOffer(raw);
  });
  const analysis = audit.analyze(rawResults, canonicalOffers);
  const report = audit.buildReport(
    {
      success: true,
      httpStatus: HTTP_OK,
      failureCategory: null,
      payload: { results: rawResults },
      rawResults,
      canonicalOffers,
    },
    analysis,
  );

  assert.equal(report.identitySummary.missingIdCount, 1);
  assert.equal(report.identitySummary.nullIdCount, 1);
  assert.equal(report.identitySummary.undefinedIdCount, 1);
  assert.equal(report.identitySummary.emptyStringifiedIdCount, 1);
  assert.equal(report.identitySummary.uniqueUsableRawIdCount, 1);
  assert.equal(report.identitySummary.duplicatedIdCount, 1);
  assert.equal(report.identitySummary.rawIdToSourceIdMatchCount, rawResults.length);
  assert.equal(report.offers[0].identity.usable, false);
  assert.equal(report.offers[1].identity.usable, false);
  assert.equal(report.offers[2].identity.usable, false);
  assert.equal(report.offers[4].identity.duplicated, true);
});

test("cardinality mismatch disables every positional check without realignment", async () => {
  const rawResults = [
    { id: "first", title: "First", description: "First text" },
    { id: "second", title: "Second", description: "Second text" },
  ];
  const connector = {
    search: async () => {
      await globalThis.fetch("https://api.adzuna.com/v1/api/jobs/fr/search/1?app_id=hidden");
      return [{ sourceId: "second" }];
    },
  };
  const audit = new AdzunaSearchAudit({
    connector,
    criteria: new SearchCriteria({ keywords: "developer" }),
    outputPath: "ignored.json",
    fetchImplementation: async () => {
      return Response.json({ results: rawResults });
    },
    writeFileImplementation: async () => {},
  });

  const report = await audit.run();

  assert.equal(report.search.mappingCardinalityMatches, false);
  assert.equal(report.search.receivedResultCount, RESULT_COUNT);
  assert.equal(report.search.canonicalOfferCount, 1);
  assert.equal(report.offers[0].mapping.positionallyComparable, false);
  assert.equal(report.offers[0].mapping.checks, null);
  assert.equal(report.offers[1].mapping.checks, null);
  assert.equal(report.deduplication.positionallyComparable, false);
  assert.equal(report.identitySummary.rawIdToSourceIdMatchCount, 0);
});

test("unexpected endpoint is blocked and external request details stay out of the report", async () => {
  let networkCallCount = 0;
  const connector = {
    search: async () => {
      return globalThis.fetch("https://evil.example.test/path?app_key=exposed");
    },
  };
  const audit = new AdzunaSearchAudit({
    connector,
    criteria: new SearchCriteria({ keywords: "developer" }),
    outputPath: "ignored.json",
    fetchImplementation: async () => {
      networkCallCount += 1;
      throw new Error("External URL with credentials");
    },
    writeFileImplementation: async () => {},
  });

  const report = await audit.run();
  const serialized = JSON.stringify(report);

  assert.equal(networkCallCount, 0);
  assert.equal(report.search.failureCategory, "UNEXPECTED_REQUEST_BLOCKED");
  assert.equal(serialized.includes("evil.example.test"), false);
  assert.equal(serialized.includes("app_key"), false);
  assert.equal(serialized.includes("exposed"), false);
});
