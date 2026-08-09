const test = require("node:test");
const assert = require("node:assert/strict");
const { HelloWorkAuditConfig } = require("../../electron/audits/hellowork/HelloWorkAuditConfig.cjs");
const { HelloWorkUrlPolicy } = require("../../electron/audits/hellowork/HelloWorkUrlPolicy.cjs");
const { HelloWorkJsonLdAnalyzer } = require("../../electron/audits/hellowork/HelloWorkJsonLdAnalyzer.cjs");

const MAXIMUM_DETAILS = 5;
const ONE_DAY_DIFFERENCE = 1;
const LONG_DESCRIPTION_LENGTH = 400;
const LOAD_DURATION_MS = 25;

/**
 * Build a pure analyzer without importing any Electron-dependent module.
 * @returns {HelloWorkJsonLdAnalyzer} Test analyzer.
 */
function createAnalyzer() {
  return new HelloWorkJsonLdAnalyzer({
    productionCleaner: (value) => {
      return value.replace(/<[^>]+>/gu, "").replace(/&amp;/gu, "&").trim();
    },
    htmlToPlainText: (value) => {
      return value.replace(/<[^>]+>/gu, "").replace(/&amp;/gu, "&").trim();
    },
    normalizeText: (value) => {
      return String(value).toLowerCase().trim();
    },
    containsHtmlLike: (value) => {
      return /<[^>]+>|&[a-z]+;/u.test(value);
    },
  });
}

test("configuration validates maximum details and required output", () => {
  const options = HelloWorkAuditConfig.parseArguments([
    "--keywords",
    "développeur",
    "--location",
    "Paris",
    "--max-details",
    String(MAXIMUM_DETAILS),
    "--output",
    "audit.json",
  ]);

  assert.equal(options.keywords, "développeur");
  assert.equal(options.location, "Paris");
  assert.equal(options.maximumDetails, MAXIMUM_DETAILS);
  assert.match(options.outputPath, /audit\.json$/u);
  assert.throws(() => {
    HelloWorkAuditConfig.parseArguments([
      "--keywords",
      "développeur",
      "--max-details",
      "11",
      "--output",
      "audit.json",
    ]);
  }, /cannot exceed/u);
});

test("URL policy accepts only credential-free exact HelloWork HTTPS origin", () => {
  const policy = new HelloWorkUrlPolicy();

  assert.equal(policy.validate("https://www.hellowork.com/fr-fr/emploi/test.html").allowed, true);
  assert.equal(policy.validate("http://www.hellowork.com/test").allowed, false);
  assert.equal(policy.validate("https://jobs.hellowork.com/test").allowed, false);
  assert.equal(policy.validate("https://www.hellowork.com:444/test").allowed, false);
  assert.equal(policy.validate("https://user:pass@www.hellowork.com/test").allowed, false);
  assert.equal(policy.validate("not a URL").reason, "INVALID_URL");
});

test("navigation guard prevents only disallowed main-frame navigation", () => {
  const policy = new HelloWorkUrlPolicy();
  let preventedCount = 0;
  const event = {
    preventDefault: () => {
      preventedCount += 1;
    },
  };

  const rejected = policy.guardNavigation(event, "https://evil.example/test?secret=value", true);
  const allowed = policy.guardNavigation(event, "https://www.hellowork.com/allowed", true);
  const subframe = policy.guardNavigation(event, "https://evil.example/frame", false);

  assert.equal(rejected.allowed, false);
  assert.equal(rejected.hostname, "evil.example");
  assert.equal(allowed.allowed, true);
  assert.equal(subframe.allowed, true);
  assert.equal(preventedCount, 1);
  assert.equal(JSON.stringify(rejected).includes("secret=value"), false);
  assert.equal(
    policy.urlsEqualIgnoringFragment(
      "https://www.hellowork.com/job?source=a#first",
      "https://www.hellowork.com/job?source=a#second",
    ),
    true,
  );
  assert.equal(
    policy.urlsEqualIgnoringFragment(
      "https://www.hellowork.com/job?source=a",
      "https://www.hellowork.com/job?source=b",
    ),
    false,
  );
  assert.equal(
    policy.urlsEqualIgnoringFragment(
      "https://www.hellowork.com/job",
      "https://evil.example/job",
    ),
    null,
  );
});

test("JSON-LD analyzer observes direct array graph nested and invalid forms", () => {
  const analyzer = createAnalyzer();
  const direct = JSON.stringify({
    "@type": "JobPosting",
    title: "Direct",
    description: "<p>Direct description</p>",
  });
  const array = JSON.stringify([{
    "@type": ["Thing", "JobPosting"],
    title: "Array",
  }]);
  const graph = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [{ wrapper: { "@type": "JobPosting", title: "Nested" } }],
  });

  const analysis = analyzer.analyzeScripts([direct, array, graph, "{invalid"]);

  assert.equal(analysis.scriptCount, 4);
  assert.equal(analysis.invalidJsonCount, 1);
  assert.equal(analysis.rootObjectCount, 2);
  assert.equal(analysis.rootArrayCount, 1);
  assert.equal(analysis.graphCount, 1);
  assert.equal(analysis.jobPostings.length, 3);
  assert.equal(analysis.jobPostings[0].nested, false);
  assert.equal(analysis.jobPostings[1].typeRepresentation, "array");
  assert.equal(analysis.jobPostings[2].nested, true);
  assert.deepEqual(analysis.jobPostings[0].pathsAndTypes.title, ["string"]);
});

test("all JobPosting candidates are compared without automatic selection", () => {
  const analyzer = createAnalyzer();
  const analysis = analyzer.analyzeScripts([
    JSON.stringify({
      "@type": "JobPosting",
      title: "Developer",
      hiringOrganization: { name: "Example" },
      jobLocation: { address: { addressLocality: "Paris" } },
      datePosted: "2026-08-02T00:00:00Z",
      url: "https://www.hellowork.com/job/developer",
    }),
    JSON.stringify({
      "@type": ["JobPosting"],
      title: "Other",
      hiringOrganization: { name: "Other company" },
      datePosted: "2026-08-03T00:00:00Z",
      url: "https://www.hellowork.com/job/other",
    }),
  ]);
  const comparison = analyzer.compareSearchToJobPostings({
    title: "developer",
    company: "example",
    location: "paris",
    publishedAt: "2026-08-01T00:00:00Z",
    applyUrl: "https://www.hellowork.com/job/developer",
  }, analysis.jobPostings);

  assert.equal(comparison.comparable, true);
  assert.equal(comparison.ambiguousJobPostingSelection, true);
  assert.equal(comparison.candidates.length, 2);
  assert.equal(comparison.candidates[0].normalizedTitleEqual, true);
  assert.equal(comparison.candidates[0].normalizedCompanyEqual, true);
  assert.equal(comparison.candidates[0].normalizedLocationEqual, true);
  assert.equal(comparison.candidates[0].dateDifferenceDays, ONE_DAY_DIFFERENCE);
  assert.equal(comparison.candidates[0].canonicalUrlComparable, true);
  assert.equal(comparison.candidates[0].canonicalUrlExactEqualsApplyUrl, true);
  assert.equal(comparison.candidates[1].normalizedTitleEqual, false);
  assert.equal(comparison.candidates[1].canonicalUrlExactEqualsApplyUrl, false);
});

test("zero and one JobPosting produce explicit comparison states", () => {
  const analyzer = createAnalyzer();
  const none = analyzer.compareSearchToJobPostings({}, []);
  const oneAnalysis = analyzer.analyzeScripts([
    JSON.stringify({ "@type": "JobPosting", title: "Developer" }),
  ]);
  const one = analyzer.compareSearchToJobPostings(
    { title: "Developer" },
    oneAnalysis.jobPostings,
  );

  assert.equal(none.comparable, false);
  assert.equal(none.ambiguousJobPostingSelection, false);
  assert.deepEqual(none.candidates, []);
  assert.equal(one.comparable, true);
  assert.equal(one.ambiguousJobPostingSelection, false);
  assert.equal(one.candidates.length, 1);
});

test("description metrics compare cleaners without serializing complete text", () => {
  const analyzer = createAnalyzer();
  const longText = `${"a".repeat(LONG_DESCRIPTION_LENGTH - 1)}z`;
  const rawDescription = `<p>${longText}</p>`;
  const analysis = analyzer.analyzeScripts([
    JSON.stringify({ "@type": "JobPosting", description: rawDescription }),
    JSON.stringify({ "@type": "JobPosting", description: "§" }),
    JSON.stringify({ "@type": "JobPosting", description: null }),
  ]);
  const safe = analyzer.toSafeAnalysis(analysis);
  const serialized = JSON.stringify(safe);
  const longMetrics = safe.jobPostings[0].description;
  const singleMetrics = safe.jobPostings[1].description;

  assert.equal(longMetrics.htmlLikeMarkupDetected, true);
  assert.equal(longMetrics.productionEqualsTextNormalizer, true);
  assert.equal(longMetrics.beginning.length <= HelloWorkAuditConfig.EXCERPT_LENGTH, true);
  assert.equal(longMetrics.end.length <= HelloWorkAuditConfig.EXCERPT_LENGTH, true);
  assert.equal(longMetrics.beginning.length + longMetrics.end.length < longText.length, true);
  assert.equal(singleMetrics.beginning, "");
  assert.equal(singleMetrics.end, "");
  assert.equal(safe.jobPostings[2].description.runtimeType, "null");
  assert.equal(serialized.includes(rawDescription), false);
  assert.equal(serialized.includes(longText), false);
});

test("safe report construction discards candidates URLs DOM data and full descriptions", () => {
  const analyzer = createAnalyzer();
  const analysis = analyzer.analyzeScripts([
    JSON.stringify({ "@type": "JobPosting", description: "Sensitive complete description" }),
  ]);
  const safeAnalysis = analyzer.toSafeAnalysis(analysis);
  const comparison = analyzer.compareSearchToJobPostings({}, analysis.jobPostings);
  const navigation = {
    initial: {
      protocol: "https:",
      hostname: "www.hellowork.com",
      allowed: true,
      sameOrigin: true,
      hasCredentials: false,
      reason: null,
    },
    final: null,
    redirectCount: 0,
    refusedRedirectCount: 0,
    refusedNavigationCount: 0,
  };
  const report = analyzer.buildReport({
    options: {
      keywords: "developer",
      location: "Paris",
      maximumDetails: 1,
    },
    search: {
      success: true,
      failureCategory: null,
      timeout: false,
      loadDurationMs: LOAD_DURATION_MS,
      navigation,
      extractedOfferCount: 1,
      eligibleDetailCount: 1,
      selectedDetailCount: 1,
      extracted: [{ href: "https://www.hellowork.com/secret?token=value" }],
      candidates: [{ applyUrl: "https://www.hellowork.com/secret?token=value" }],
    },
    offers: [{
      search: { sourceIdHash: "hash", applyUrlHash: "hash" },
      load: {
        success: true,
        failureCategory: null,
        timeout: false,
        loadDurationMs: LOAD_DURATION_MS,
        navigation,
      },
      jsonLd: safeAnalysis,
      comparison,
    }],
  });
  const serialized = JSON.stringify(report);

  assert.equal(report.summary.testedDetailCount, 1);
  assert.equal(report.summary.descriptionPresentCount, 1);
  assert.equal("candidates" in report.search, false);
  assert.equal("extracted" in report.search, false);
  assert.equal(serialized.includes("token=value"), false);
  assert.equal(serialized.includes("Sensitive complete description"), false);
});

test("failed loads do not count as missing JSON-LD or missing JobPosting", () => {
  const analyzer = createAnalyzer();
  const navigation = {
    initial: {
      protocol: "https:",
      hostname: "www.hellowork.com",
      allowed: true,
      sameOrigin: true,
      hasCredentials: false,
      reason: null,
    },
    final: null,
    redirectCount: 0,
    refusedRedirectCount: 0,
    refusedNavigationCount: 0,
    finalUrlEqualsInitial: null,
  };
  const report = analyzer.buildReport({
    options: {
      keywords: "developer",
      location: "Paris",
      maximumDetails: 1,
    },
    search: {
      success: true,
      failureCategory: null,
      timeout: false,
      loadDurationMs: LOAD_DURATION_MS,
      navigation,
      extractedOfferCount: 1,
      eligibleDetailCount: 1,
      selectedDetailCount: 1,
    },
    offers: [{
      search: { sourceIdHash: "hash", applyUrlHash: "hash" },
      load: {
        success: false,
        failureCategory: "LOAD_FAILED",
        timeout: false,
        loadDurationMs: LOAD_DURATION_MS,
        navigation,
      },
      jsonLd: analyzer.toSafeAnalysis(analyzer.analyzeScripts([])),
      comparison: {
        comparable: false,
        ambiguousJobPostingSelection: false,
        candidates: [],
      },
    }],
  });

  assert.equal(report.summary.successfulLoadCount, 0);
  assert.equal(report.summary.missingJsonLdCount, 0);
  assert.equal(report.summary.missingJobPostingCount, 0);
});
