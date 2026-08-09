import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { AdzunaConstants } from "../../src/constants/AdzunaConstants.js";
import { DateNormalizer } from "../../src/normalization/DateNormalizer.js";
import { TextNormalizer } from "../../src/normalization/TextNormalizer.js";
import { AdzunaSearchAuditConfig } from "./AdzunaSearchAuditConfig.js";

const WORD_SEPARATOR_PATTERN = /\s+/u;
const ELLIPSIS_AT_END_PATTERN = /(?:\.\.\.|…|â€¦)\s*$/u;
const REQUEST_FAILED = "REQUEST_FAILED";
const HTTP_ERROR = "HTTP_ERROR";
const INVALID_JSON = "INVALID_JSON";
const INVALID_PAYLOAD = "INVALID_PAYLOAD";
const UNEXPECTED_REQUEST_BLOCKED = "UNEXPECTED_REQUEST_BLOCKED";
const UNKNOWN_STATUS = null;
const SENSITIVE_PATH_SEGMENTS = Object.freeze(["app_id", "app_key"]);
const MAPPED_INPUT_PATHS = Object.freeze([
  "id",
  "title",
  "description",
  "company",
  "company.display_name",
  "location",
  "location.display_name",
  "location.area",
  "location.area[]",
  "latitude",
  "longitude",
  "contract_type",
  "salary_min",
  "salary_max",
  "redirect_url",
  "created",
]);

/**
 * Audit one Adzuna search response and its mapping into canonical offers.
 */
class AdzunaSearchAudit {
  /**
   * Create the audit from the production connector and injectable I/O.
   * @param {object} dependencies - Audit dependencies.
   * @param {import("../../src/connectors/AdzunaConnector.js").AdzunaConnector} dependencies.connector - Production connector.
   * @param {import("../../src/models/SearchCriteria.js").SearchCriteria} dependencies.criteria - Search criteria.
   * @param {string} dependencies.outputPath - Report destination.
   * @param {typeof fetch} dependencies.fetchImplementation - Fetch implementation.
   * @param {typeof writeFile} [dependencies.writeFileImplementation] - Injectable writer.
   */
  constructor({
    connector,
    criteria,
    outputPath,
    fetchImplementation,
    writeFileImplementation = writeFile,
  }) {
    this.connector = connector;
    this.criteria = criteria;
    this.outputPath = outputPath;
    this.fetchImplementation = fetchImplementation;
    this.writeFileImplementation = writeFileImplementation;
    this.searchEndpoint = new URL(AdzunaConstants.SEARCH_ENDPOINT);
    this.mappedInputPaths = new Set(MAPPED_INPUT_PATHS);
  }

  /**
   * Execute one search and write a safe factual report.
   * @returns {Promise<object>} Safe report.
   */
  async run() {
    const capture = await this.captureSearch();
    const analysis = this.analyze(capture.rawResults, capture.canonicalOffers);
    const report = this.buildReport(capture, analysis);
    const serialized = JSON.stringify(
      report,
      null,
      AdzunaSearchAuditConfig.REPORT_INDENTATION,
    );
    await this.writeFileImplementation(this.outputPath, serialized, "utf8");
    return report;
  }

  /**
   * Call the production connector while capturing only the raw response body.
   * @returns {Promise<object>} Safe search capture with in-memory payload data.
   */
  async captureSearch() {
    const capture = {
      success: false,
      httpStatus: UNKNOWN_STATUS,
      failureCategory: null,
      payload: null,
      rawResults: [],
      canonicalOffers: [],
    };
    const originalGlobalFetch = globalThis.fetch;
    globalThis.fetch = this.createGuardedFetch(capture);
    try {
      capture.canonicalOffers = await this.connector.search(this.criteria);
      if (!capture.failureCategory) {
        capture.success = true;
      }
    } catch {
      capture.failureCategory ??= REQUEST_FAILED;
    } finally {
      globalThis.fetch = originalGlobalFetch;
    }
    return capture;
  }

  /**
   * Guard the single expected endpoint without retaining its query string.
   * @param {object} capture - Mutable capture.
   * @returns {typeof fetch} Guarded fetch implementation.
   */
  createGuardedFetch(capture) {
    return async (input, init) => {
      const requestUrl = this.extractUrl(input);
      if (!this.matchesSearchEndpoint(requestUrl)) {
        capture.failureCategory = UNEXPECTED_REQUEST_BLOCKED;
        throw new Error("Unexpected request blocked by Adzuna audit");
      }
      const response = await this.fetchImplementation(input, init);
      capture.httpStatus = response.status;
      if (!response.ok) {
        capture.failureCategory = HTTP_ERROR;
        return response;
      }
      try {
        const payload = await response.clone().json();
        capture.payload = payload;
        if (!payload || typeof payload !== "object" || !Array.isArray(payload.results)) {
          capture.failureCategory = INVALID_PAYLOAD;
        } else {
          capture.rawResults = payload.results;
        }
      } catch {
        capture.failureCategory = INVALID_JSON;
      }
      return response;
    };
  }

  /**
   * Analyze descriptions, identities, paths, mapping and exact-key collisions.
   * @param {object[]} rawResults - Raw search results.
   * @param {object[]} canonicalOffers - Connector output.
   * @returns {object} Internal analysis.
   */
  analyze(rawResults, canonicalOffers) {
    const mappingCardinalityMatches = rawResults.length === canonicalOffers.length;
    const identityRecords = rawResults.map((raw) => {
      return this.analyzeIdentity(raw);
    });
    const duplicateKeys = this.findDuplicateIdentityKeys(identityRecords);
    const observedPaths = new Set();
    const offers = rawResults.map((raw, index) => {
      const rawPaths = [...this.inventoryPaths(raw)].sort();
      for (const path of rawPaths) {
        observedPaths.add(path);
      }
      const identity = identityRecords[index];
      return {
        resultIndex: index,
        identity: {
          ...identity.safe,
          duplicated: identity.usableKey ? duplicateKeys.has(identity.usableKey) : false,
        },
        description: this.measureDescription(raw?.description),
        redirectUrl: this.measureRedirectUrl(raw?.redirect_url),
        mapping: this.analyzeMapping(
          raw,
          mappingCardinalityMatches ? canonicalOffers[index] : null,
          rawPaths,
          mappingCardinalityMatches,
        ),
        usableIdentityKey: identity.usableKey,
      };
    });
    return {
      mappingCardinalityMatches,
      observedPaths: [...observedPaths].sort(),
      identityRecords,
      offers,
      deduplication: this.analyzeDeduplication(offers, canonicalOffers, mappingCardinalityMatches),
    };
  }

  /**
   * Analyze raw.id while separating usability from production coercion.
   * @param {object} raw - Raw result.
   * @returns {object} Internal identity record.
   */
  analyzeIdentity(raw) {
    const propertyExists = Object.hasOwn(raw ?? {}, "id");
    const value = propertyExists ? raw.id : undefined;
    const isNull = value === null;
    const isUndefined = propertyExists && value === undefined;
    const stringified = propertyExists ? String(value) : "";
    const trimmed = stringified.trim();
    const usable = propertyExists && !isNull && !isUndefined && trimmed.length > 0;
    const usableKey = usable ? JSON.stringify([typeof value, trimmed]) : null;
    return {
      usableKey,
      sourceIdCoercion: propertyExists ? stringified : "undefined",
      safe: {
        rawIdType: propertyExists ? this.runtimeType(value) : "missing",
        propertyExists,
        null: isNull,
        undefined: isUndefined,
        emptyAfterStringTrim: propertyExists && !isNull && !isUndefined && trimmed.length === 0,
        usable,
        idHash: usable ? this.hash(usableKey) : null,
      },
    };
  }

  /**
   * Find distinct usable identity values occurring more than once.
   * @param {object[]} records - Identity records.
   * @returns {Set<string>} Duplicated usable keys.
   */
  findDuplicateIdentityKeys(records) {
    const counts = new Map();
    for (const record of records) {
      if (record.usableKey) {
        counts.set(record.usableKey, (counts.get(record.usableKey) ?? 0) + 1);
      }
    }
    return new Set([...counts.entries()].filter(([, count]) => {
      return count > 1;
    }).map(([key]) => {
      return key;
    }));
  }

  /**
   * Measure a raw snippet and a temporary plain-text representation.
   * @param {unknown} value - Raw description.
   * @returns {object} Safe measurements plus temporary text.
   */
  measureDescription(value) {
    const present = typeof value === "string";
    const rawText = present ? value : "";
    const normalizedText = present ? TextNormalizer.htmlToPlainText(rawText) ?? "" : "";
    const excerpts = this.buildDescriptionExcerpts(normalizedText);
    return {
      present,
      rawLength: rawText.length,
      normalizedLength: normalizedText.length,
      wordCount: this.countWords(normalizedText),
      rawHash: present ? this.hash(rawText) : null,
      normalizedHash: present ? this.hash(normalizedText) : null,
      beginning: excerpts.beginning,
      end: excerpts.end,
      rawEndsWithEllipsis: present && ELLIPSIS_AT_END_PATTERN.test(rawText),
      normalizedEndsWithEllipsis: present && ELLIPSIS_AT_END_PATTERN.test(normalizedText),
      htmlLikeMarkupDetected: present && TextNormalizer.containsHtmlOrEntity(rawText),
      rawToNormalizedLengthDifference: normalizedText.length - rawText.length,
      normalizedText,
    };
  }

  /**
   * Build non-overlapping excerpts while always omitting part of non-empty text.
   * @param {string} normalizedText - Complete normalized description held in memory.
   * @returns {{beginning: string, end: string}} Safe bounded excerpts.
   */
  buildDescriptionExcerpts(normalizedText) {
    if (!normalizedText) {
      return { beginning: "", end: "" };
    }
    const maximumCombinedLength = AdzunaSearchAuditConfig.EXCERPT_LENGTH * 2;
    const combinedLength = Math.min(normalizedText.length - 1, maximumCombinedLength);
    const beginningLength = Math.min(
      AdzunaSearchAuditConfig.EXCERPT_LENGTH,
      Math.ceil(combinedLength / 2),
    );
    const endLength = combinedLength - beginningLength;
    return {
      beginning: normalizedText.slice(0, beginningLength),
      end: endLength > 0 ? normalizedText.slice(-endLength) : "",
    };
  }

  /**
   * Measure redirect presence and host without retaining the URL.
   * @param {unknown} value - Raw redirect value.
   * @returns {object} Safe redirect measurements.
   */
  measureRedirectUrl(value) {
    const present = typeof value === "string" && value.length > 0;
    if (!present) {
      return { present: false, validUrl: false, host: null };
    }
    try {
      return { present: true, validUrl: true, host: new URL(value).host || null };
    } catch {
      return { present: true, validUrl: false, host: null };
    }
  }

  /**
   * Compare a positionally aligned raw result and canonical offer.
   * @param {object} raw - Raw result.
   * @param {object|null} offer - Canonical offer at the same position.
   * @param {string[]} observedPaths - Paths observed on the raw result.
   * @param {boolean} comparable - Whether cardinalities preserve alignment.
   * @returns {object} Path classification and mapping checks.
   */
  analyzeMapping(raw, offer, observedPaths, comparable) {
    const mappedInputPaths = observedPaths.filter((path) => {
      return this.mappedInputPaths.has(path);
    });
    const unmappedPaths = observedPaths.filter((path) => {
      return !this.mappedInputPaths.has(path);
    });
    if (!comparable) {
      return {
        positionallyComparable: false,
        observedPaths,
        mappedInputPaths,
        unmappedPaths,
        checks: null,
      };
    }
    const expectedSalary = this.connector.buildSalary(raw);
    return {
      positionallyComparable: true,
      observedPaths,
      mappedInputPaths,
      unmappedPaths,
      checks: {
        sourceId: offer.sourceId === String(raw.id),
        title: offer.title === raw.title,
        description: offer.description === (raw.description ?? null),
        companyName: offer.company?.name === (raw.company?.display_name ?? null),
        locationLabel: offer.location?.label === (raw.location?.display_name ?? null),
        locationCity: offer.location?.city === this.connector.extractCity(raw.location ?? {}),
        latitude: offer.location?.latitude === (raw.latitude ?? null),
        longitude: offer.location?.longitude === (raw.longitude ?? null),
        contractType: offer.contractType === this.connector.resolveContractType(raw),
        contractTypeLabel: offer.contractTypeLabel === (raw.contract_type ?? null),
        salaryMinimum: offer.salary?.min === expectedSalary.min,
        salaryMaximum: offer.salary?.max === expectedSalary.max,
        redirectUrl: offer.applyUrl === (raw.redirect_url ?? null),
        publishedAt: offer.publishedAt === DateNormalizer.toIso(raw.created),
      },
    };
  }

  /**
   * Analyze exact deduplication keys among distinct usable raw identifiers.
   * @param {object[]} analyzedOffers - Internal offer records.
   * @param {object[]} canonicalOffers - Canonical offers.
   * @param {boolean} comparable - Whether positional alignment is valid.
   * @returns {object} Safe collision report.
   */
  analyzeDeduplication(analyzedOffers, canonicalOffers, comparable) {
    if (!comparable) {
      return {
        positionallyComparable: false,
        uniqueExactKeyCount: null,
        collidingExactKeyCount: null,
        offersAffectedByCollisionCount: null,
        collisions: [],
      };
    }
    const groups = new Map();
    for (let index = 0; index < analyzedOffers.length; index += 1) {
      const identityKey = analyzedOffers[index].usableIdentityKey;
      if (!identityKey) {
        continue;
      }
      const deduplicationKey = canonicalOffers[index].getDeduplicationKey();
      const group = groups.get(deduplicationKey) ?? [];
      group.push(identityKey);
      groups.set(deduplicationKey, group);
    }
    const collisions = [];
    let offersAffectedByCollisionCount = 0;
    for (const [key, identities] of groups) {
      const distinctIdentities = [...new Set(identities)];
      if (distinctIdentities.length > 1) {
        offersAffectedByCollisionCount += identities.length;
        collisions.push({
          deduplicationKeyHash: this.hash(key),
          distinctRawIdHashes: distinctIdentities.map((identity) => {
            return this.hash(identity);
          }).sort(),
          distinctRawIdCount: distinctIdentities.length,
          offerCount: identities.length,
        });
      }
    }
    return {
      positionallyComparable: true,
      uniqueExactKeyCount: groups.size,
      collidingExactKeyCount: collisions.length,
      offersAffectedByCollisionCount,
      collisions,
    };
  }

  /**
   * Build the final safe report.
   * @param {object} capture - Search capture.
   * @param {object} analysis - Internal analysis.
   * @returns {object} Safe serializable report.
   */
  buildReport(capture, analysis) {
    const usableRecords = analysis.identityRecords.filter((record) => {
      return Boolean(record.usableKey);
    });
    const usableKeys = new Set(usableRecords.map((record) => {
      return record.usableKey;
    }));
    const duplicateKeys = this.findDuplicateIdentityKeys(analysis.identityRecords);
    const coercionGroups = this.groupIdentitiesByCoercion(usableRecords);
    const positionallyComparableOffers = analysis.offers.filter((offer) => {
      return offer.mapping.positionallyComparable;
    });
    const mappedPaths = analysis.observedPaths.filter((path) => {
      return this.mappedInputPaths.has(path);
    });
    const unmappedPaths = analysis.observedPaths.filter((path) => {
      return !this.mappedInputPaths.has(path);
    });
    return {
      schemaVersion: AdzunaSearchAuditConfig.SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      criteria: {
        keywords: this.criteria.keywords,
        location: this.criteria.location,
        distanceKm: this.criteria.distanceKm,
      },
      methodology: {
        endpointOrigin: this.searchEndpoint.origin,
        endpointPathname: this.searchEndpoint.pathname,
        page: 1,
        resultsPerPage: AdzunaConstants.RESULTS_PER_PAGE,
        normalization: "TextNormalizer.htmlToPlainText used for analysis only",
        rawToNormalizedLengthDifference: "normalized length minus raw length",
        htmlLikeMarkupDetected: "heuristic detection of known markup or HTML entities; not proof that content is HTML",
        positionalMapping: "raw and canonical values are compared by index only when result cardinalities match because AdzunaConnector.search currently uses synchronous Array.map",
        usableRawId: "property exists, value is neither null nor undefined, and String(raw.id).trim() is non-empty",
        distinctRawId: "type-sensitive pair of runtime type and trimmed string value",
        duplicatedIdCount: "number of distinct usable type-sensitive raw IDs occurring more than once",
        fullDescriptionsSerialized: false,
        unmappedPathMeaning: "observed payload path not consumed by the current connector mapping; no utility judgment",
      },
      search: {
        success: capture.success,
        httpStatus: capture.httpStatus,
        failureCategory: capture.failureCategory,
        receivedResultCount: capture.rawResults.length,
        canonicalOfferCount: capture.canonicalOffers.length,
        mappingCardinalityMatches: analysis.mappingCardinalityMatches,
        observedTopLevelPaths: capture.payload
          ? Object.keys(capture.payload).filter((path) => {
            return this.isReportablePath(path);
          }).sort()
          : [],
        observedTopLevelNumericMetadata: this.topLevelNumericMetadata(capture.payload),
      },
      identitySummary: {
        observedRawIdTypes: this.countIdentityTypes(analysis.identityRecords),
        missingIdCount: analysis.identityRecords.filter((record) => {
          return !record.safe.propertyExists;
        }).length,
        nullIdCount: analysis.identityRecords.filter((record) => {
          return record.safe.null;
        }).length,
        undefinedIdCount: analysis.identityRecords.filter((record) => {
          return record.safe.undefined;
        }).length,
        emptyStringifiedIdCount: analysis.identityRecords.filter((record) => {
          return record.safe.emptyAfterStringTrim;
        }).length,
        uniqueUsableRawIdCount: usableKeys.size,
        duplicatedIdCount: duplicateKeys.size,
        sourceIdCoercionCollisionCount: [...coercionGroups.values()].filter((keys) => {
          return keys.size > 1;
        }).length,
        rawIdToSourceIdMatchCount: positionallyComparableOffers.filter((offer) => {
          return offer.mapping.checks.sourceId;
        }).length,
        rawIdToSourceIdMismatchCount: positionallyComparableOffers.filter((offer) => {
          return !offer.mapping.checks.sourceId;
        }).length,
      },
      deduplication: analysis.deduplication,
      mappingSummary: {
        observedPaths: analysis.observedPaths,
        observedMappedInputPaths: mappedPaths,
        observedUnmappedPaths: unmappedPaths,
        unmappedPathOccurrences: this.countUnmappedPathOccurrences(analysis.offers),
        mappingVerificationFailures: this.countMappingFailures(positionallyComparableOffers),
      },
      offers: analysis.offers.map((offer) => {
        return this.toSafeOffer(offer);
      }),
    };
  }

  /**
   * Group usable type-sensitive identities by production String coercion.
   * @param {object[]} records - Usable identity records.
   * @returns {Map<string, Set<string>>} Identity keys grouped by coercion.
   */
  groupIdentitiesByCoercion(records) {
    const groups = new Map();
    for (const record of records) {
      const keys = groups.get(record.sourceIdCoercion) ?? new Set();
      keys.add(record.usableKey);
      groups.set(record.sourceIdCoercion, keys);
    }
    return groups;
  }

  /**
   * Return finite numeric metadata observed directly under the payload root.
   * @param {object|null} payload - Raw search payload.
   * @returns {object[]} Uninterpreted numeric metadata.
   */
  topLevelNumericMetadata(payload) {
    if (!payload || typeof payload !== "object") {
      return [];
    }
    return Object.entries(payload).filter(([path, value]) => {
      return this.isReportablePath(path)
        && typeof value === "number"
        && Number.isFinite(value);
    }).map(([path, value]) => {
      return { path, value };
    }).sort((left, right) => {
      return left.path.localeCompare(right.path);
    });
  }

  /**
   * Count observed raw ID runtime types.
   * @param {object[]} records - Identity records.
   * @returns {object} Counts keyed by type.
   */
  countIdentityTypes(records) {
    const counts = new Map();
    for (const record of records) {
      const type = record.safe.rawIdType;
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return Object.fromEntries([...counts.entries()].sort(([left], [right]) => {
      return left.localeCompare(right);
    }));
  }

  /**
   * Count unmapped path occurrences across raw results.
   * @param {object[]} offers - Internal offer analyses.
   * @returns {object} Counts keyed by path.
   */
  countUnmappedPathOccurrences(offers) {
    const counts = new Map();
    for (const offer of offers) {
      for (const path of offer.mapping.unmappedPaths) {
        counts.set(path, (counts.get(path) ?? 0) + 1);
      }
    }
    return Object.fromEntries([...counts.entries()].sort(([left], [right]) => {
      return left.localeCompare(right);
    }));
  }

  /**
   * Count failed mapping checks across comparable positions.
   * @param {object[]} offers - Positionally comparable analyses.
   * @returns {object} Failure counts keyed by check.
   */
  countMappingFailures(offers) {
    const counts = new Map();
    for (const offer of offers) {
      for (const [name, passed] of Object.entries(offer.mapping.checks)) {
        if (!passed) {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
    }
    return Object.fromEntries([...counts.entries()].sort(([left], [right]) => {
      return left.localeCompare(right);
    }));
  }

  /**
   * Remove temporary full text and internal identity keys.
   * @param {object} offer - Internal offer analysis.
   * @returns {object} Safe offer analysis.
   */
  toSafeOffer(offer) {
    const { normalizedText, ...safeDescription } = offer.description;
    const { usableIdentityKey, ...safeOffer } = offer;
    void normalizedText;
    void usableIdentityKey;
    return { ...safeOffer, description: safeDescription };
  }

  /**
   * Inventory generalized JSON paths without retaining values.
   * @param {unknown} value - Payload value.
   * @returns {Set<string>} Observed paths.
   */
  inventoryPaths(value) {
    const paths = new Set();
    this.visitValue(value, "", paths);
    return paths;
  }

  /**
   * Recursively visit objects and generalized array elements.
   * @param {unknown} value - Current value.
   * @param {string} path - Current path.
   * @param {Set<string>} paths - Mutable path set.
   * @returns {void}
   */
  visitValue(value, path, paths) {
    if (path && this.isReportablePath(path)) {
      paths.add(path);
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        this.visitValue(item, `${path}[]`, paths);
      }
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        this.visitValue(child, path ? `${path}.${key}` : key, paths);
      }
    }
  }

  /**
   * Exclude credential names and URL-like dynamic keys from reportable paths.
   * @param {string} path - Observed JSON path.
   * @returns {boolean} True when the path is safe to serialize.
   */
  isReportablePath(path) {
    const segments = path.split(/[.[\]]/u).filter(Boolean);
    return !path.includes("://")
      && !path.includes("?")
      && !segments.some((segment) => {
        return SENSITIVE_PATH_SEGMENTS.includes(segment.toLowerCase());
      });
  }

  /**
   * Extract a URL from a supported fetch input.
   * @param {RequestInfo|URL} input - Fetch input.
   * @returns {URL} Parsed URL.
   */
  extractUrl(input) {
    if (input instanceof Request) {
      return new URL(input.url);
    }
    return new URL(input.toString());
  }

  /**
   * Compare only the expected origin and pathname.
   * @param {URL} requestUrl - Candidate URL.
   * @returns {boolean} True for the configured search resource.
   */
  matchesSearchEndpoint(requestUrl) {
    return requestUrl.origin === this.searchEndpoint.origin
      && requestUrl.pathname === this.searchEndpoint.pathname;
  }

  /**
   * Return a precise runtime type label.
   * @param {unknown} value - Candidate value.
   * @returns {string} Runtime type.
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
   * Count whitespace-separated words.
   * @param {string} value - Plain text.
   * @returns {number} Word count.
   */
  countWords(value) {
    const collapsed = TextNormalizer.collapseWhitespace(value);
    if (!collapsed) {
      return 0;
    }
    return collapsed.split(WORD_SEPARATOR_PATTERN).length;
  }

  /**
   * Hash a value for safe comparisons.
   * @param {string} value - Value to hash.
   * @returns {string} Hexadecimal digest.
   */
  hash(value) {
    return createHash(AdzunaSearchAuditConfig.HASH_ALGORITHM)
      .update(value)
      .digest(AdzunaSearchAuditConfig.HASH_ENCODING);
  }
}

export { AdzunaSearchAudit };
