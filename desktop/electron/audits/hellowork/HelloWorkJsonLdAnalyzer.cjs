const { createHash } = require("node:crypto");
const { HelloWorkAuditConfig } = require("./HelloWorkAuditConfig.cjs");

const ELLIPSIS_AT_END_PATTERN = /(?:\.\.\.|…|â€¦)\s*$/u;
const TARGET_FIELDS = Object.freeze([
  "description",
  "title",
  "datePosted",
  "employmentType",
  "hiringOrganization",
  "jobLocation",
  "baseSalary",
  "skills",
  "qualifications",
  "validThrough",
  "identifier",
  "url",
]);

/**
 * Pure parser and measurement engine for observed HelloWork JSON-LD.
 */
class HelloWorkJsonLdAnalyzer {
  /**
   * Create the analyzer with injected pure text operations.
   * @param {object} dependencies - Text dependencies.
   * @param {(value: string) => string|null} dependencies.productionCleaner - Current HelloWork cleaner.
   * @param {(value: string) => string|null} dependencies.htmlToPlainText - Comparative shared normalizer.
   * @param {(value: unknown) => string} dependencies.normalizeText - Deterministic comparison normalizer.
   * @param {(value: string) => boolean} dependencies.containsHtmlLike - Conservative markup heuristic.
   */
  constructor({ productionCleaner, htmlToPlainText, normalizeText, containsHtmlLike }) {
    this.productionCleaner = productionCleaner;
    this.htmlToPlainText = htmlToPlainText;
    this.normalizeText = normalizeText;
    this.containsHtmlLike = containsHtmlLike;
  }

  /**
   * Parse every JSON-LD script and inventory all observed JobPosting objects.
   * @param {unknown[]} scriptContents - Raw script text values returned by the page.
   * @returns {object} Safe analysis plus temporary comparison values.
   */
  analyzeScripts(scriptContents) {
    const contents = Array.isArray(scriptContents) ? scriptContents : [];
    const result = {
      scriptCount: contents.length,
      invalidJsonCount: 0,
      rootObjectCount: 0,
      rootArrayCount: 0,
      rootPrimitiveCount: 0,
      graphCount: 0,
      typeStringCount: 0,
      typeArrayCount: 0,
      jobPostings: [],
    };
    for (let scriptIndex = 0; scriptIndex < contents.length; scriptIndex += 1) {
      const content = contents[scriptIndex];
      if (typeof content !== "string") {
        result.invalidJsonCount += 1;
        continue;
      }
      let root;
      try {
        root = JSON.parse(content);
      } catch {
        result.invalidJsonCount += 1;
        continue;
      }
      this.countRootType(root, result);
      this.visitJsonLd(root, {
        scriptIndex,
        depth: 0,
        result,
      });
    }
    return result;
  }

  /**
   * Count the runtime shape of a parsed JSON-LD root.
   * @param {unknown} root - Parsed root.
   * @param {object} result - Mutable result.
   * @returns {void}
   */
  countRootType(root, result) {
    if (Array.isArray(root)) {
      result.rootArrayCount += 1;
      return;
    }
    if (root && typeof root === "object") {
      result.rootObjectCount += 1;
      return;
    }
    result.rootPrimitiveCount += 1;
  }

  /**
   * Recursively observe objects, arrays, graphs and JobPosting types.
   * @param {unknown} value - Current JSON value.
   * @param {object} context - Traversal context.
   * @returns {void}
   */
  visitJsonLd(value, context) {
    if (Array.isArray(value)) {
      for (const item of value) {
        this.visitJsonLd(item, { ...context, depth: context.depth + 1 });
      }
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    if (Array.isArray(value["@graph"])) {
      context.result.graphCount += 1;
    }
    const typeRepresentation = this.typeRepresentation(value["@type"]);
    if (typeRepresentation === "string") {
      context.result.typeStringCount += 1;
    } else if (typeRepresentation === "array") {
      context.result.typeArrayCount += 1;
    }
    if (this.hasJobPostingType(value["@type"])) {
      context.result.jobPostings.push(this.analyzeJobPosting(
        value,
        context.scriptIndex,
        context.depth,
        typeRepresentation,
        context.result.jobPostings.length,
      ));
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") {
        this.visitJsonLd(child, { ...context, depth: context.depth + 1 });
      }
    }
  }

  /**
   * Tell whether an @type representation names JobPosting.
   * @param {unknown} value - @type value.
   * @returns {boolean} True when JobPosting is included.
   */
  hasJobPostingType(value) {
    if (value === "JobPosting") {
      return true;
    }
    return Array.isArray(value) && value.includes("JobPosting");
  }

  /**
   * Classify the observed representation of @type.
   * @param {unknown} value - @type value.
   * @returns {string} Safe representation label.
   */
  typeRepresentation(value) {
    if (typeof value === "string") {
      return "string";
    }
    if (Array.isArray(value)) {
      return "array";
    }
    if (value === undefined) {
      return "absent";
    }
    return this.runtimeType(value);
  }

  /**
   * Analyze one JobPosting without serializing its original values.
   * @param {object} posting - Observed JobPosting.
   * @param {number} scriptIndex - Source script index.
   * @param {number} depth - Traversal depth.
   * @param {string} typeRepresentation - Observed @type representation.
   * @param {number} jobPostingIndex - Stable observation index.
   * @returns {object} Safe measurements plus temporary comparison data.
   */
  analyzeJobPosting(posting, scriptIndex, depth, typeRepresentation, jobPostingIndex) {
    return {
      jobPostingIndex,
      scriptIndex,
      nested: depth > 0,
      typeRepresentation,
      pathsAndTypes: this.inventoryPathsAndTypes(posting),
      targetFields: this.measureTargetFields(posting),
      description: this.measureDescription(posting.description),
      comparisonValues: {
        title: typeof posting.title === "string" ? posting.title : null,
        company: typeof posting.hiringOrganization?.name === "string"
          ? posting.hiringOrganization.name
          : null,
        locations: this.collectStrings(posting.jobLocation),
        datePosted: typeof posting.datePosted === "string" ? posting.datePosted : null,
        identifierObserved: Object.hasOwn(posting, "identifier"),
        canonicalUrlObserved: Object.hasOwn(posting, "url"),
        canonicalUrl: typeof posting.url === "string" ? posting.url : null,
        identifierHash: Object.hasOwn(posting, "identifier")
          ? this.hashJsonValue(posting.identifier)
          : null,
        canonicalUrlHash: Object.hasOwn(posting, "url")
          ? this.hashJsonValue(posting.url)
          : null,
      },
    };
  }

  /**
   * Measure presence and runtime types of target JobPosting fields.
   * @param {object} posting - JobPosting object.
   * @returns {object} Target field observations.
   */
  measureTargetFields(posting) {
    return Object.fromEntries(TARGET_FIELDS.map((field) => {
      const present = Object.hasOwn(posting, field);
      return [field, {
        present,
        runtimeType: present ? this.runtimeType(posting[field]) : null,
      }];
    }));
  }

  /**
   * Measure raw and normalized description representations safely.
   * @param {unknown} value - JobPosting description.
   * @returns {object} Description measurements with temporary full text.
   */
  measureDescription(value) {
    const present = value !== undefined;
    const runtimeType = present ? this.runtimeType(value) : "absent";
    const textual = typeof value === "string";
    const rawText = textual ? value : "";
    const production = textual ? this.tryNormalize(this.productionCleaner, rawText) : null;
    const comparative = textual ? this.tryNormalize(this.htmlToPlainText, rawText) : null;
    const productionText = production?.value ?? "";
    const comparativeText = comparative?.value ?? "";
    const excerpts = this.buildExcerpts(comparativeText);
    return {
      present,
      runtimeType,
      textual,
      empty: textual ? rawText.length === 0 : null,
      rawHtmlLength: textual ? rawText.length : null,
      productionCleanLength: production ? productionText.length : null,
      textNormalizerLength: comparative ? comparativeText.length : null,
      rawHash: textual ? this.hash(rawText) : null,
      productionCleanHash: production ? this.hash(productionText) : null,
      textNormalizerHash: comparative ? this.hash(comparativeText) : null,
      productionEqualsTextNormalizer: production && comparative
        ? productionText === comparativeText
        : null,
      productionCleanSuccess: production !== null,
      textNormalizerSuccess: comparative !== null,
      rawEndsWithEllipsis: textual && ELLIPSIS_AT_END_PATTERN.test(rawText),
      productionCleanEndsWithEllipsis: production
        ? ELLIPSIS_AT_END_PATTERN.test(productionText)
        : null,
      htmlLikeMarkupDetected: textual && this.containsHtmlLike(rawText),
      beginning: excerpts.beginning,
      end: excerpts.end,
      temporaryText: comparativeText,
    };
  }

  /**
   * Apply a text function while converting failures to null.
   * @param {(value: string) => string|null} operation - Pure text operation.
   * @param {string} value - Text to normalize.
   * @returns {{value: string}|null} Safe operation result.
   */
  tryNormalize(operation, value) {
    try {
      const normalized = operation(value);
      return { value: normalized ?? "" };
    } catch {
      return null;
    }
  }

  /**
   * Build non-overlapping excerpts that always omit non-empty content.
   * @param {string} value - Complete text held only in memory.
   * @returns {{beginning: string, end: string}} Safe excerpts.
   */
  buildExcerpts(value) {
    if (!value) {
      return { beginning: "", end: "" };
    }
    const maximumCombinedLength = HelloWorkAuditConfig.EXCERPT_LENGTH
      * HelloWorkAuditConfig.EXCERPT_PORTION_COUNT;
    const combinedLength = Math.min(value.length - 1, maximumCombinedLength);
    const beginningLength = Math.min(
      HelloWorkAuditConfig.EXCERPT_LENGTH,
      Math.ceil(combinedLength / HelloWorkAuditConfig.EXCERPT_PORTION_COUNT),
    );
    const endLength = combinedLength - beginningLength;
    return {
      beginning: value.slice(0, beginningLength),
      end: endLength > 0 ? value.slice(-endLength) : "",
    };
  }

  /**
   * Build comparisons for every observed JobPosting without selecting one.
   * @param {object} searchOffer - Search offer fields held in memory.
   * @param {object[]} jobPostings - Analyzed JobPosting records.
   * @returns {object} Candidate comparisons and ambiguity state.
   */
  compareSearchToJobPostings(searchOffer, jobPostings) {
    const candidates = jobPostings.map((posting) => {
      return this.compareCandidate(searchOffer, posting);
    });
    return {
      comparable: candidates.length > 0,
      ambiguousJobPostingSelection: candidates.length > 1,
      candidates,
    };
  }

  /**
   * Compare one search offer to one observed JobPosting deterministically.
   * @param {object} searchOffer - Search values.
   * @param {object} posting - Analyzed posting.
   * @returns {object} Deterministic comparison.
   */
  compareCandidate(searchOffer, posting) {
    const values = posting.comparisonValues;
    const searchDate = this.parseDate(searchOffer.publishedAt);
    const detailDate = this.parseDate(values.datePosted);
    const dateDifferenceDays = searchDate && detailDate
      ? (detailDate.getTime() - searchDate.getTime()) / HelloWorkAuditConfig.MILLISECONDS_PER_DAY
      : null;
    return {
      jobPostingIndex: posting.jobPostingIndex,
      titleComparable: Boolean(searchOffer.title && values.title),
      normalizedTitleEqual: this.compareNormalized(searchOffer.title, values.title),
      companyComparable: Boolean(searchOffer.company && values.company),
      normalizedCompanyEqual: this.compareNormalized(searchOffer.company, values.company),
      locationComparable: Boolean(searchOffer.location && values.locations.length > 0),
      normalizedLocationEqual: searchOffer.location && values.locations.length > 0
        ? values.locations.some((location) => {
          return this.compareNormalized(searchOffer.location, location) === true;
        })
        : null,
      dateComparable: Boolean(searchDate && detailDate),
      dateExactlyEqual: searchDate && detailDate
        ? searchDate.getTime() === detailDate.getTime()
        : null,
      dateDifferenceDays,
      identifierObserved: values.identifierObserved,
      canonicalUrlObserved: values.canonicalUrlObserved,
      identifierHash: values.identifierHash,
      canonicalUrlHash: values.canonicalUrlHash,
      canonicalUrlComparable: typeof searchOffer.applyUrl === "string"
        && typeof values.canonicalUrl === "string",
      canonicalUrlExactEqualsApplyUrl: typeof searchOffer.applyUrl === "string"
        && typeof values.canonicalUrl === "string"
        ? searchOffer.applyUrl === values.canonicalUrl
        : null,
    };
  }

  /**
   * Compare two optional strings after deterministic normalization.
   * @param {unknown} left - Search value.
   * @param {unknown} right - Detail value.
   * @returns {boolean|null} Equality or null when not comparable.
   */
  compareNormalized(left, right) {
    if (typeof left !== "string" || typeof right !== "string" || !left || !right) {
      return null;
    }
    return this.normalizeText(left) === this.normalizeText(right);
  }

  /**
   * Parse an optional date safely.
   * @param {unknown} value - Candidate date.
   * @returns {Date|null} Valid date.
   */
  parseDate(value) {
    if (!value) {
      return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  /**
   * Inventory generalized paths and runtime types.
   * @param {unknown} value - JSON value.
   * @returns {object} Sorted type arrays keyed by path.
   */
  inventoryPathsAndTypes(value) {
    const paths = new Map();
    this.visitPath(value, "", paths);
    return Object.fromEntries([...paths.entries()].sort(([left], [right]) => {
      return left.localeCompare(right);
    }).map(([path, types]) => {
      return [path, [...types].sort()];
    }));
  }

  /**
   * Visit generalized JSON paths recursively.
   * @param {unknown} value - Current value.
   * @param {string} path - Current path.
   * @param {Map<string, Set<string>>} paths - Mutable inventory.
   * @returns {void}
   */
  visitPath(value, path, paths) {
    if (path && this.isReportablePath(path)) {
      const types = paths.get(path) ?? new Set();
      types.add(this.runtimeType(value));
      paths.set(path, types);
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        this.visitPath(item, `${path}[]`, paths);
      }
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        this.visitPath(child, path ? `${path}.${key}` : key, paths);
      }
    }
  }

  /**
   * Tell whether an observed JSON path is safe to serialize.
   * @param {string} path - Observed path.
   * @returns {boolean} True when the path does not resemble a complete URL.
   */
  isReportablePath(path) {
    return !path.includes("://") && !path.includes("?") && !path.includes("#");
  }

  /**
   * Collect string leaves from a structured value for in-memory comparison.
   * @param {unknown} value - Structured JSON value.
   * @returns {string[]} String leaves.
   */
  collectStrings(value) {
    if (typeof value === "string") {
      return [value];
    }
    if (Array.isArray(value)) {
      return value.flatMap((item) => {
        return this.collectStrings(item);
      });
    }
    if (value && typeof value === "object") {
      return Object.values(value).flatMap((item) => {
        return this.collectStrings(item);
      });
    }
    return [];
  }

  /**
   * Remove all temporary full text and comparison values before serialization.
   * @param {object} analysis - Internal JSON-LD analysis.
   * @returns {object} Safe serializable analysis.
   */
  toSafeAnalysis(analysis) {
    return {
      ...analysis,
      jobPostings: analysis.jobPostings.map((posting) => {
        const { comparisonValues, ...safePosting } = posting;
        const { temporaryText, ...safeDescription } = safePosting.description;
        void comparisonValues;
        void temporaryText;
        return { ...safePosting, description: safeDescription };
      }),
    };
  }

  /**
   * Build the complete safe report from already measured search and detail data.
   * @param {object} params - Report inputs.
   * @param {object} params.options - Audit criteria.
   * @param {object} params.search - Internal search result.
   * @param {object[]} params.offers - Safe detail reports.
   * @returns {object} Complete safe report.
   */
  buildReport({ options, search, offers }) {
    const successfullyLoadedOffers = offers.filter((offer) => {
      return offer.load.success;
    });
    const jobPostingCounts = successfullyLoadedOffers.map((offer) => {
      return offer.jsonLd.jobPostings.length;
    });
    return {
      schemaVersion: HelloWorkAuditConfig.SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      criteria: {
        keywords: options.keywords,
        location: options.location,
        maximumDetails: options.maximumDetails,
      },
      methodology: {
        session: "random non-persistent in-memory Electron partition",
        allowedOrigin: HelloWorkAuditConfig.ALLOWED_ORIGIN,
        detailsAreSequential: true,
        detailUrlsComeOnlyFromCurrentSearch: true,
        fullUrlsSerialized: false,
        fullDescriptionsSerialized: false,
        multipleJobPostings: "all candidates compared independently; none selected automatically",
        dateDifferenceDays: "detail datePosted minus approximate SEARCH date in 24-hour days",
        finalUrlEqualsInitial: "exact URL equality after removing fragments; URLs remain in memory only",
        canonicalUrlExactEqualsApplyUrl: "exact in-memory string equality when JobPosting.url and SEARCH applyUrl are strings",
      },
      search: this.toSafeSearchResult(search),
      summary: {
        testedDetailCount: offers.length,
        successfulLoadCount: offers.filter((offer) => {
          return offer.load.success;
        }).length,
        timeoutCount: offers.filter((offer) => {
          return offer.load.timeout;
        }).length,
        missingJsonLdCount: successfullyLoadedOffers.filter((offer) => {
          return offer.jsonLd.scriptCount === 0;
        }).length,
        invalidJsonLdBlockCount: offers.reduce((sum, offer) => {
          return sum + offer.jsonLd.invalidJsonCount;
        }, 0),
        missingJobPostingCount: jobPostingCounts.filter((count) => {
          return count === 0;
        }).length,
        multipleJobPostingCount: jobPostingCounts.filter((count) => {
          return count > 1;
        }).length,
        refusedRedirectCount: offers.reduce((sum, offer) => {
          return sum + offer.load.navigation.refusedRedirectCount;
        }, 0),
        refusedFinalOriginCount: offers.filter((offer) => {
          return offer.load.failureCategory === "FINAL_ORIGIN_REFUSED";
        }).length,
        descriptionPresentCount: offers.reduce((sum, offer) => {
          return sum + offer.jsonLd.jobPostings.filter((posting) => {
            return posting.description.present;
          }).length;
        }, 0),
        nonEmptyDescriptionCount: offers.reduce((sum, offer) => {
          return sum + offer.jsonLd.jobPostings.filter((posting) => {
            return posting.description.textual && !posting.description.empty;
          }).length;
        }, 0),
      },
      offers,
    };
  }

  /**
   * Whitelist safe search measurements and discard DOM results and candidate URLs.
   * @param {object} search - Internal search result.
   * @returns {object} Safe search report.
   */
  toSafeSearchResult(search) {
    return {
      success: search.success,
      failureCategory: search.failureCategory,
      timeout: search.timeout,
      loadDurationMs: search.loadDurationMs,
      navigation: search.navigation,
      extractedOfferCount: search.extractedOfferCount,
      eligibleDetailCount: search.eligibleDetailCount,
      selectedDetailCount: search.selectedDetailCount,
    };
  }

  /**
   * Return a precise runtime type.
   * @param {unknown} value - Candidate value.
   * @returns {string} Runtime type label.
   */
  runtimeType(value) {
    if (value === null) {
      return "null";
    }
    if (Array.isArray(value)) {
      return "array";
    }
    return typeof value;
  }

  /**
   * Hash a value for safe exact comparisons.
   * @param {string} value - Value to hash.
   * @returns {string} Hexadecimal SHA-256 digest.
   */
  hash(value) {
    return createHash(HelloWorkAuditConfig.HASH_ALGORITHM)
      .update(value)
      .digest(HelloWorkAuditConfig.HASH_ENCODING);
  }

  /**
   * Hash a JSON value without exposing or retaining its serialized form.
   * @param {unknown} value - Observed JSON value.
   * @returns {string|null} Digest or null when serialization fails.
   */
  hashJsonValue(value) {
    try {
      const serialized = JSON.stringify(value);
      return serialized === undefined ? null : this.hash(serialized);
    } catch {
      return null;
    }
  }
}

module.exports = { HelloWorkJsonLdAnalyzer };
