import test from "node:test";
import assert from "node:assert/strict";
import { FranceTravailConnector } from "../../src/connectors/FranceTravailConnector.js";
import { SearchCriteria } from "../../src/models/SearchCriteria.js";
import { FranceTravailDetailAudit } from "../../scripts/france-travail-detail/FranceTravailDetailAudit.js";
import { FranceTravailDetailAuditConfig } from "../../scripts/france-travail-detail/FranceTravailDetailAuditConfig.js";

const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const TOKEN_LIFETIME_SECONDS = 3600;
const EXPECTED_SEARCH_LENGTH = 9;
const EXPECTED_DETAIL_LENGTH = 18;
const EXPECTED_CHARACTER_GAIN = 9;
const EXPECTED_COMMON_PREFIX_LENGTH = 9;
const EXPECTED_GAIN_RATIO = 1;
const EXPECTED_TESTED_COUNT = 2;
const MAXIMUM_DETAILS = 2;
const CONFIGURED_DISTANCE_KM = 15;
const ABOVE_MAXIMUM_DETAILS = 21;
const NUMERIC_QUALIFICATION = 8;
const OFFER_ONE_ID = "offer/one";
const OFFER_TWO_ID = "offer-two";
const ACCESS_TOKEN = "audit-secret-token";
const SEARCH_DESCRIPTION = "<p>Hello job</p>";
const DETAIL_DESCRIPTION = "<p>Hello job extended</p>";

test("configuration validates the detail limit and resolves supported arguments", () => {
  const options = FranceTravailDetailAuditConfig.parseArguments([
    "--keywords",
    "node.js",
    "--commune-insee",
    "75056",
    "--distance-km",
    String(CONFIGURED_DISTANCE_KM),
    "--max-details",
    "2",
    "--output",
    "audit.json",
  ]);

  assert.equal(options.keywords, "node.js");
  assert.equal(options.communeInsee, "75056");
  assert.equal(options.distanceKm, CONFIGURED_DISTANCE_KM);
  assert.equal(options.maximumDetails, MAXIMUM_DETAILS);
  assert.match(options.outputPath, /audit\.json$/u);
  assert.throws(() => {
    FranceTravailDetailAuditConfig.parseArguments([
      "--keywords",
      "node",
      "--max-details",
      String(ABOVE_MAXIMUM_DETAILS),
      "--output",
      "audit.json",
    ]);
  }, /cannot exceed/u);
});

test("audit compares official identities sequentially and serializes only safe measurements", async () => {
  const searchPayload = {
    resultats: [
      {
        id: OFFER_ONE_ID,
        intitule: "Developer",
        description: SEARCH_DESCRIPTION,
        competences: [{ code: "A", libelle: "API" }],
        qualification: "employee",
      },
      {
        id: OFFER_TWO_ID,
        intitule: "Tester",
        description: "Same",
        qualification: "employee",
      },
    ],
  };
  const detailPayloads = new Map([
    [OFFER_ONE_ID, {
      ...searchPayload.resultats[0],
      description: DETAIL_DESCRIPTION,
      formations: [{ domaineLibelle: "Computing" }],
      qualification: NUMERIC_QUALIFICATION,
    }],
    [OFFER_TWO_ID, { ...searchPayload.resultats[1] }],
  ]);
  let activeDetailRequests = 0;
  let maximumActiveDetailRequests = 0;
  const requestedDetailIds = [];
  const fetchImplementation = async (input, init = {}) => {
    const url = new URL(input.toString());
    if (url.pathname.includes("access_token")) {
      return Response.json({ access_token: ACCESS_TOKEN, expires_in: TOKEN_LIFETIME_SECONDS });
    }
    if (url.pathname.endsWith("/search")) {
      return Response.json(searchPayload);
    }
    activeDetailRequests += 1;
    maximumActiveDetailRequests = Math.max(maximumActiveDetailRequests, activeDetailRequests);
    const encodedId = url.pathname.split("/").at(-1);
    const id = decodeURIComponent(encodedId);
    requestedDetailIds.push(id);
    assert.equal(init.headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
    await Promise.resolve();
    activeDetailRequests -= 1;
    return Response.json(detailPayloads.get(id));
  };
  let serializedReport = "";
  const connector = new FranceTravailConnector({
    clientId: "test-client",
    clientSecret: "test-secret",
    scope: "o2dsoffre api_offresdemploiv2",
  });
  const audit = new FranceTravailDetailAudit({
    connector,
    criteria: new SearchCriteria({ keywords: "node" }),
    maximumDetails: MAXIMUM_DETAILS,
    outputPath: "ignored.json",
    fetchImplementation,
    writeFileImplementation: async (outputPath, contents, encoding) => {
      assert.equal(outputPath, "ignored.json");
      assert.equal(encoding, "utf8");
      serializedReport = contents;
    },
  });

  const report = await audit.run();

  assert.deepEqual(requestedDetailIds, [OFFER_ONE_ID, OFFER_TWO_ID]);
  assert.equal(maximumActiveDetailRequests, 1);
  assert.equal(report.selection.testedOfferCount, EXPECTED_TESTED_COUNT);
  assert.equal(report.summary.detailSuccessCount, EXPECTED_TESTED_COUNT);
  assert.equal(report.summary.identicalCount, 1);
  const firstOffer = report.offers[0];
  assert.equal(firstOffer.searchDescription.normalizedLength, EXPECTED_SEARCH_LENGTH);
  assert.equal(firstOffer.detailDescription.normalizedLength, EXPECTED_DETAIL_LENGTH);
  assert.equal(firstOffer.descriptionComparison.searchIsDetailPrefix, true);
  assert.equal(firstOffer.descriptionComparison.detailIsSearchPrefix, false);
  assert.equal(firstOffer.descriptionComparison.commonPrefixLength, EXPECTED_COMMON_PREFIX_LENGTH);
  assert.equal(firstOffer.descriptionComparison.characterDifference, EXPECTED_CHARACTER_GAIN);
  assert.equal(firstOffer.descriptionComparison.normalizedLengthGainRatio, EXPECTED_GAIN_RATIO);
  assert.deepEqual(firstOffer.businessFields.detailOnlyPaths, [
    "formations",
    "formations[]",
    "formations[].domaineLibelle",
  ]);
  assert.deepEqual(firstOffer.businessFields.commonPathsWithRuntimeTypeDifference, [{
    path: "qualification",
    searchTypes: ["string"],
    detailTypes: ["number"],
  }]);
  assert.equal("normalizedText" in firstOffer.searchDescription, false);
  assert.equal(serializedReport.includes(ACCESS_TOKEN), false);
  assert.equal(serializedReport.includes("Authorization"), false);
  assert.equal(serializedReport.includes(DETAIL_DESCRIPTION), false);
});

test("audit reports a documented missing offer without attempting to parse a body", async () => {
  const connector = {
    search: async () => {
      const response = await globalThis.fetch("https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search");
      const payload = await response.json();
      return payload.resultats.map((raw) => {
        return { sourceId: raw.id };
      });
    },
    ensureToken: async () => {
      return ACCESS_TOKEN;
    },
  };
  const fetchImplementation = async (input) => {
    const url = new URL(input.toString());
    if (url.pathname.endsWith("/search")) {
      return Response.json({ resultats: [{ id: OFFER_TWO_ID, description: null }] });
    }
    return new Response(null, { status: HTTP_NO_CONTENT });
  };
  const audit = new FranceTravailDetailAudit({
    connector,
    criteria: new SearchCriteria({ keywords: "node" }),
    maximumDetails: 1,
    outputPath: "ignored.json",
    fetchImplementation,
    writeFileImplementation: async () => {},
  });

  const report = await audit.run();

  assert.equal(report.offers[0].detail.success, false);
  assert.equal(report.offers[0].detail.httpStatus, HTTP_NO_CONTENT);
  assert.equal(report.offers[0].detail.failureCategory, "OFFER_NOT_FOUND");
  assert.equal(report.offers[0].descriptionComparison, null);
  assert.equal(report.summary.detailSuccessRate, 0);
});

test("path inventory generalizes array indexes and retains observed runtime types", () => {
  const audit = new FranceTravailDetailAudit({
    connector: {},
    criteria: {},
    maximumDetails: 1,
    outputPath: "ignored.json",
    fetchImplementation: async () => {
      return new Response(null, { status: HTTP_OK });
    },
  });

  const comparison = audit.comparePayloadPaths(
    { values: [{ code: "A" }, { code: null }] },
    { values: [{ code: 1 }], extra: true },
  );

  assert.deepEqual(comparison.detailOnlyPaths, ["extra"]);
  assert.deepEqual(comparison.commonPathsWithRuntimeTypeDifference, [{
    path: "values[].code",
    searchTypes: ["null", "string"],
    detailTypes: ["number"],
  }]);
});

test("description statistics exclude missing and empty texts from identical proportion", () => {
  const audit = new FranceTravailDetailAudit({
    connector: {},
    criteria: { keywords: "node", communeInsee: null, distanceKm: 0 },
    maximumDetails: 1,
    outputPath: "ignored.json",
    fetchImplementation: async () => {
      return new Response(null, { status: HTTP_OK });
    },
  });
  const emptyBusinessFields = {
    searchPaths: [],
    detailPaths: [],
    detailOnlyPaths: [],
    searchOnlyPaths: [],
    commonPathsWithRuntimeTypeDifference: [],
  };
  const buildComparison = (searchValue, detailValue) => {
    const searchDescription = audit.measureDescription(searchValue);
    const detailDescription = audit.measureDescription(detailValue);
    return {
      offerIdHash: "hash",
      detail: { success: true, httpStatus: HTTP_OK, failureCategory: null },
      searchDescription,
      detailDescription,
      descriptionComparison: audit.compareDescriptions(searchDescription, detailDescription),
      businessFields: emptyBusinessFields,
    };
  };
  const bothMissing = buildComparison(null, null);
  const searchMissing = buildComparison(null, "Detail text");
  const detailMissing = buildComparison("Search text", null);
  const bothPresentAndIdentical = buildComparison("Same text", "Same text");

  assert.equal(bothMissing.descriptionComparison.exactlyIdentical, true);
  assert.equal(bothMissing.descriptionComparison.searchIsDetailPrefix, false);
  assert.equal(bothMissing.descriptionComparison.detailIsSearchPrefix, false);
  assert.equal(searchMissing.descriptionComparison.searchIsDetailPrefix, false);
  assert.equal(searchMissing.descriptionComparison.detailIsSearchPrefix, false);
  assert.equal(searchMissing.descriptionComparison.normalizedLengthGainRatio, null);
  assert.equal(detailMissing.descriptionComparison.searchIsDetailPrefix, false);
  assert.equal(detailMissing.descriptionComparison.detailIsSearchPrefix, false);
  assert.equal(bothPresentAndIdentical.descriptionComparison.exactlyIdentical, true);
  assert.equal(bothPresentAndIdentical.descriptionComparison.searchIsDetailPrefix, true);
  assert.equal(bothPresentAndIdentical.descriptionComparison.detailIsSearchPrefix, true);

  const report = audit.buildReport(
    { success: true, httpStatus: HTTP_OK, failureCategory: null, rawOffers: [] },
    { eligibleCount: 4, missingIdentityCount: 0, ambiguousIdentityCount: 0 },
    [bothMissing, searchMissing, detailMissing, bothPresentAndIdentical],
  );

  assert.equal(report.summary.bothDescriptionsPresentCount, 1);
  assert.equal(report.summary.bothDescriptionsMissingCount, 1);
  assert.equal(report.summary.searchDescriptionMissingCount, 1);
  assert.equal(report.summary.detailDescriptionMissingCount, 1);
  assert.equal(report.summary.descriptionComparableCount, 1);
  assert.equal(report.summary.identicalCount, 1);
  assert.equal(report.summary.identicalProportion, 1);
});
