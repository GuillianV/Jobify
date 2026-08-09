import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { FranceTravailConstants } from "../../src/constants/FranceTravailConstants.js";
import { TextNormalizer } from "../../src/normalization/TextNormalizer.js";
import { FranceTravailDetailAuditConfig } from "./FranceTravailDetailAuditConfig.js";

const DETAIL_ENDPOINT_PREFIX = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/";
const WORD_SEPARATOR_PATTERN = /\s+/u;
const ELLIPSIS_AT_END_PATTERN = /(?:\.\.\.|…|â€¦)\s*$/u;
const SEARCH_REQUEST_FAILED = "SEARCH_REQUEST_FAILED";
const SEARCH_PAYLOAD_INVALID = "SEARCH_PAYLOAD_INVALID";
const DETAIL_REQUEST_FAILED = "DETAIL_REQUEST_FAILED";
const DETAIL_PAYLOAD_INVALID = "DETAIL_PAYLOAD_INVALID";
const OFFER_NOT_FOUND = "OFFER_NOT_FOUND";
const BAD_REQUEST = "BAD_REQUEST";
const SERVER_ERROR = "SERVER_ERROR";
const HTTP_ERROR = "HTTP_ERROR";
const UNKNOWN_STATUS = null;

/**
 * Compare France Travail search payloads with official per-offer detail payloads.
 */
class FranceTravailDetailAudit {
  /**
   * Create the audit from production connector dependencies.
   * @param {object} dependencies - Audit dependencies.
   * @param {import("../../src/connectors/FranceTravailConnector.js").FranceTravailConnector} dependencies.connector - Production connector.
   * @param {import("../../src/models/SearchCriteria.js").SearchCriteria} dependencies.criteria - Search criteria.
   * @param {number} dependencies.maximumDetails - Maximum sequential detail requests.
   * @param {string} dependencies.outputPath - Report destination.
   * @param {typeof fetch} dependencies.fetchImplementation - Fetch implementation.
   * @param {typeof writeFile} [dependencies.writeFileImplementation] - Injectable report writer.
   */
  constructor({
    connector,
    criteria,
    maximumDetails,
    outputPath,
    fetchImplementation,
    writeFileImplementation = writeFile,
  }) {
    this.connector = connector;
    this.criteria = criteria;
    this.maximumDetails = maximumDetails;
    this.outputPath = outputPath;
    this.fetchImplementation = fetchImplementation;
    this.writeFileImplementation = writeFileImplementation;
    this.searchEndpoint = new URL(FranceTravailConstants.SEARCH_ENDPOINT);
    this.tokenEndpoint = new URL(FranceTravailConstants.TOKEN_ENDPOINT);
  }

  /**
   * Run the search, request details sequentially and write a safe JSON report.
   * @returns {Promise<object>} The safe report written to disk.
   */
  async run() {
    const searchCapture = await this.captureSearch();
    const candidates = this.selectCandidates(searchCapture.rawOffers, searchCapture.offers);
    const comparisons = [];
    for (const candidate of candidates.selected) {
      comparisons.push(await this.compareCandidate(candidate));
    }
    const report = this.buildReport(searchCapture, candidates, comparisons);
    const serialized = JSON.stringify(
      report,
      null,
      FranceTravailDetailAuditConfig.REPORT_INDENTATION,
    );
    await this.writeFileImplementation(this.outputPath, serialized, "utf8");
    return report;
  }

  /**
   * Call the production search while capturing its raw payload in memory.
   * @returns {Promise<object>} Search outcome and raw offers.
   */
  async captureSearch() {
    const capture = {
      success: false,
      httpStatus: UNKNOWN_STATUS,
      failureCategory: null,
      rawOffers: [],
      offers: [],
    };
    const originalGlobalFetch = globalThis.fetch;
    globalThis.fetch = this.createSearchFetch(capture);
    try {
      capture.offers = await this.connector.search(this.criteria);
      capture.success = true;
    } catch {
      capture.failureCategory ??= SEARCH_REQUEST_FAILED;
    } finally {
      globalThis.fetch = originalGlobalFetch;
    }
    return capture;
  }

  /**
   * Build a guarded fetch wrapper for OAuth and the known search endpoint.
   * @param {object} capture - Mutable search capture.
   * @returns {typeof fetch} Guarded fetch implementation.
   */
  createSearchFetch(capture) {
    return async (input, init) => {
      const requestUrl = this.extractUrl(input);
      if (this.urlsMatch(requestUrl, this.tokenEndpoint)) {
        return this.fetchImplementation(input, init);
      }
      if (!this.urlsMatch(requestUrl, this.searchEndpoint)) {
        throw new Error("Unexpected network request blocked by France Travail audit");
      }
      const response = await this.fetchImplementation(input, init);
      capture.httpStatus = response.status;
      if (response.ok && response.status !== 204) {
        try {
          const payload = await response.clone().json();
          if (!Array.isArray(payload?.resultats)) {
            capture.failureCategory = SEARCH_PAYLOAD_INVALID;
          } else {
            capture.rawOffers = payload.resultats;
          }
        } catch {
          capture.failureCategory = SEARCH_PAYLOAD_INVALID;
        }
      }
      return response;
    };
  }

  /**
   * Select uniquely matched raw and canonical offers using only raw.id.
   * @param {object[]} rawOffers - Raw search results.
   * @param {object[]} offers - Canonical search results.
   * @returns {object} Selected candidates and exclusion counts.
   */
  selectCandidates(rawOffers, offers) {
    const rawGroups = this.groupByIdentity(rawOffers, (offer) => {
      return offer?.id;
    });
    const canonicalGroups = this.groupByIdentity(offers, (offer) => {
      return offer?.sourceId;
    });
    const selected = [];
    let missingIdentityCount = rawOffers.length - this.countGroupedValues(rawGroups);
    let ambiguousIdentityCount = 0;
    for (const [id, matchingRawOffers] of rawGroups) {
      const matchingOffers = canonicalGroups.get(id) ?? [];
      if (matchingRawOffers.length !== 1 || matchingOffers.length !== 1) {
        ambiguousIdentityCount += matchingRawOffers.length;
        continue;
      }
      if (selected.length < this.maximumDetails) {
        selected.push({ id, raw: matchingRawOffers[0] });
      }
    }
    for (const [id, matchingOffers] of canonicalGroups) {
      if (!rawGroups.has(id)) {
        missingIdentityCount += matchingOffers.length;
      }
    }
    return {
      selected,
      missingIdentityCount,
      ambiguousIdentityCount,
      eligibleCount: [...rawGroups.values()].filter((group) => {
        return group.length === 1 && canonicalGroups.get(group[0].id)?.length === 1;
      }).length,
    };
  }

  /**
   * Request and compare one detail payload.
   * @param {object} candidate - Search offer paired by its official identifier.
   * @returns {Promise<object>} Internal comparison record.
   */
  async compareCandidate(candidate) {
    const detailResult = await this.requestDetail(candidate.id);
    const searchDescription = this.measureDescription(candidate.raw.description);
    const detailDescription = this.measureDescription(detailResult.payload?.description);
    const businessFields = detailResult.success
      ? this.comparePayloadPaths(candidate.raw, detailResult.payload)
      : this.emptyBusinessFields(candidate.raw);
    return {
      offerIdHash: this.hash(candidate.id),
      detail: {
        success: detailResult.success,
        httpStatus: detailResult.httpStatus,
        failureCategory: detailResult.failureCategory,
      },
      searchDescription,
      detailDescription,
      descriptionComparison: detailResult.success
        ? this.compareDescriptions(searchDescription, detailDescription)
        : null,
      businessFields,
    };
  }

  /**
   * Fetch one official detail resource without exposing request data.
   * @param {string} id - Official offer identifier from search raw.id.
   * @returns {Promise<object>} Safe status plus an in-memory payload.
   */
  async requestDetail(id) {
    const url = `${DETAIL_ENDPOINT_PREFIX}${encodeURIComponent(id)}`;
    try {
      const token = await this.connector.ensureToken();
      const response = await this.fetchImplementation(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 204) {
        return this.detailFailure(response.status, OFFER_NOT_FOUND);
      }
      if (!response.ok) {
        return this.detailFailure(response.status, this.classifyHttpStatus(response.status));
      }
      try {
        const payload = await response.json();
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          return this.detailFailure(response.status, DETAIL_PAYLOAD_INVALID);
        }
        return {
          success: true,
          httpStatus: response.status,
          failureCategory: null,
          payload,
        };
      } catch {
        return this.detailFailure(response.status, DETAIL_PAYLOAD_INVALID);
      }
    } catch {
      return this.detailFailure(UNKNOWN_STATUS, DETAIL_REQUEST_FAILED);
    }
  }

  /**
   * Create a failed detail result.
   * @param {number|null} httpStatus - Observed status or null.
   * @param {string} failureCategory - Safe failure category.
   * @returns {object} Failed detail result.
   */
  detailFailure(httpStatus, failureCategory) {
    return { success: false, httpStatus, failureCategory, payload: null };
  }

  /**
   * Classify a documented or unexpected HTTP error status.
   * @param {number} status - HTTP response status.
   * @returns {string} Safe failure category.
   */
  classifyHttpStatus(status) {
    if (status === 400) {
      return BAD_REQUEST;
    }
    if (status === 500) {
      return SERVER_ERROR;
    }
    return HTTP_ERROR;
  }

  /**
   * Measure one raw external description while retaining full text only in memory.
   * @param {unknown} rawValue - Raw description value.
   * @returns {object} Internal description measurements.
   */
  measureDescription(rawValue) {
    const present = typeof rawValue === "string";
    const rawText = present ? rawValue : "";
    const normalizedText = present ? TextNormalizer.htmlToPlainText(rawText) ?? "" : "";
    return {
      present,
      rawLength: rawText.length,
      normalizedLength: normalizedText.length,
      wordCount: this.countWords(normalizedText),
      rawHash: present ? this.hash(rawText) : null,
      normalizedHash: present ? this.hash(normalizedText) : null,
      beginning: normalizedText.slice(0, FranceTravailDetailAuditConfig.EXCERPT_LENGTH),
      end: normalizedText.slice(-FranceTravailDetailAuditConfig.EXCERPT_LENGTH),
      rawEndsWithEllipsis: present && ELLIPSIS_AT_END_PATTERN.test(rawText),
      normalizedEndsWithEllipsis: present && ELLIPSIS_AT_END_PATTERN.test(normalizedText),
      normalizedText,
    };
  }

  /**
   * Compare two normalized descriptions deterministically.
   * @param {object} search - Search description measurements.
   * @param {object} detail - Detail description measurements.
   * @returns {object} Deterministic comparison metrics.
   */
  compareDescriptions(search, detail) {
    const characterDifference = detail.normalizedLength - search.normalizedLength;
    let normalizedLengthGainRatio = null;
    if (search.normalizedLength > 0) {
      normalizedLengthGainRatio = characterDifference / search.normalizedLength;
    } else if (detail.normalizedLength === 0) {
      normalizedLengthGainRatio = 0;
    }
    return {
      exactlyIdentical: search.normalizedText === detail.normalizedText,
      searchIsDetailPrefix: search.normalizedText.length > 0
        && detail.normalizedText.startsWith(search.normalizedText),
      detailIsSearchPrefix: detail.normalizedText.length > 0
        && search.normalizedText.startsWith(detail.normalizedText),
      commonPrefixLength: this.commonPrefixLength(search.normalizedText, detail.normalizedText),
      characterDifference,
      normalizedLengthGainRatio,
    };
  }

  /**
   * Calculate the shared prefix length of two strings.
   * @param {string} left - First value.
   * @param {string} right - Second value.
   * @returns {number} Shared prefix length.
   */
  commonPrefixLength(left, right) {
    const maximum = Math.min(left.length, right.length);
    let index = 0;
    while (index < maximum && left[index] === right[index]) {
      index += 1;
    }
    return index;
  }

  /**
   * Compare paths and runtime types observed in two payloads.
   * @param {object} searchPayload - Raw search offer.
   * @param {object} detailPayload - Raw detail offer.
   * @returns {object} Factual payload path comparison.
   */
  comparePayloadPaths(searchPayload, detailPayload) {
    const searchPaths = this.inventoryPaths(searchPayload);
    const detailPaths = this.inventoryPaths(detailPayload);
    const searchPathNames = [...searchPaths.keys()].sort();
    const detailPathNames = [...detailPaths.keys()].sort();
    return {
      searchPaths: searchPathNames,
      detailPaths: detailPathNames,
      detailOnlyPaths: detailPathNames.filter((path) => {
        return !searchPaths.has(path);
      }),
      searchOnlyPaths: searchPathNames.filter((path) => {
        return !detailPaths.has(path);
      }),
      commonPathsWithRuntimeTypeDifference: searchPathNames.filter((path) => {
        return detailPaths.has(path)
          && this.serializeTypes(searchPaths.get(path)) !== this.serializeTypes(detailPaths.get(path));
      }).map((path) => {
        return {
          path,
          searchTypes: [...searchPaths.get(path)].sort(),
          detailTypes: [...detailPaths.get(path)].sort(),
        };
      }),
    };
  }

  /**
   * Return search paths when no detail payload can be compared.
   * @param {object} searchPayload - Raw search offer.
   * @returns {object} Factual path inventory without comparison claims.
   */
  emptyBusinessFields(searchPayload) {
    return {
      searchPaths: [...this.inventoryPaths(searchPayload).keys()].sort(),
      detailPaths: [],
      detailOnlyPaths: [],
      searchOnlyPaths: [],
      commonPathsWithRuntimeTypeDifference: [],
    };
  }

  /**
   * Inventory every runtime path without retaining payload values.
   * @param {unknown} value - Payload value.
   * @returns {Map<string, Set<string>>} Runtime types grouped by generalized path.
   */
  inventoryPaths(value) {
    const paths = new Map();
    this.visitValue(value, "", paths);
    return paths;
  }

  /**
   * Visit a payload recursively using generalized array paths.
   * @param {unknown} value - Current payload value.
   * @param {string} path - Current JSON path.
   * @param {Map<string, Set<string>>} paths - Mutable path inventory.
   * @returns {void}
   */
  visitValue(value, path, paths) {
    if (path) {
      const types = paths.get(path) ?? new Set();
      types.add(this.runtimeType(value));
      paths.set(path, types);
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        this.visitValue(item, `${path}[]`, paths);
      }
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        const childPath = path ? `${path}.${key}` : key;
        this.visitValue(child, childPath, paths);
      }
    }
  }

  /**
   * Return a precise JSON runtime type label.
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
   * Serialize a type set for stable equality comparisons.
   * @param {Set<string>} types - Runtime types.
   * @returns {string} Stable type representation.
   */
  serializeTypes(types) {
    return [...types].sort().join("|");
  }

  /**
   * Build the final safe report and aggregate metrics.
   * @param {object} searchCapture - Search outcome.
   * @param {object} candidates - Candidate selection metadata.
   * @param {object[]} comparisons - Per-offer comparisons.
   * @returns {object} Safe serializable report.
   */
  buildReport(searchCapture, candidates, comparisons) {
    const successful = comparisons.filter((comparison) => {
      return comparison.detail.success;
    });
    const descriptionComparisons = successful.map((comparison) => {
      return comparison.descriptionComparison;
    });
    const bothDescriptionsPresent = successful.filter((comparison) => {
      return comparison.searchDescription.present && comparison.detailDescription.present;
    });
    const bothDescriptionsMissingCount = successful.filter((comparison) => {
      return !comparison.searchDescription.present && !comparison.detailDescription.present;
    }).length;
    const searchDescriptionMissingCount = successful.filter((comparison) => {
      return !comparison.searchDescription.present && comparison.detailDescription.present;
    }).length;
    const detailDescriptionMissingCount = successful.filter((comparison) => {
      return comparison.searchDescription.present && !comparison.detailDescription.present;
    }).length;
    const comparableDescriptions = bothDescriptionsPresent.filter((comparison) => {
      return comparison.searchDescription.normalizedLength > 0
        && comparison.detailDescription.normalizedLength > 0;
    });
    const gains = descriptionComparisons.map((comparison) => {
      return comparison.characterDifference;
    });
    const identicalCount = comparableDescriptions.filter((comparison) => {
      return comparison.descriptionComparison.exactlyIdentical;
    }).length;
    const detailLongerCount = gains.filter((gain) => {
      return gain > 0;
    }).length;
    const searchLongerCount = gains.filter((gain) => {
      return gain < 0;
    }).length;
    return {
      schemaVersion: FranceTravailDetailAuditConfig.SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      criteria: {
        keywords: this.criteria.keywords,
        communeInsee: this.criteria.communeInsee,
        distanceKm: this.criteria.distanceKm,
        requestedMaximumDetails: this.maximumDetails,
      },
      methodology: {
        identity: "strict equality between SEARCH raw.id and the DETAIL path parameter",
        sharedContractSchema: "#/components/schemas/Offre",
        normalization: "TextNormalizer.htmlToPlainText",
        hash: FranceTravailDetailAuditConfig.HASH_ALGORITHM,
        lengthUnit: "JavaScript UTF-16 code units",
        detailsAreSequential: true,
        fullDescriptionsSerialized: false,
        normalizedLengthGainRatio: "(detail normalized length - search normalized length) / search normalized length; null when only search length is zero",
        descriptionPresencePopulation: "exclusive counts among successful DETAIL responses: both descriptions are strings, neither is a string, only SEARCH is missing, or only DETAIL is missing",
        descriptionComparablePopulation: "successful DETAIL responses where SEARCH and DETAIL descriptions are strings and both normalized texts are non-empty",
        identicalProportionPopulation: "descriptionComparableCount only",
      },
      search: {
        success: searchCapture.success,
        httpStatus: searchCapture.httpStatus,
        failureCategory: searchCapture.failureCategory,
        resultCount: searchCapture.rawOffers.length,
      },
      selection: {
        eligibleCount: candidates.eligibleCount,
        testedOfferCount: comparisons.length,
        missingIdentityCount: candidates.missingIdentityCount,
        ambiguousIdentityCount: candidates.ambiguousIdentityCount,
      },
      summary: {
        detailSuccessCount: successful.length,
        detailSuccessRate: this.proportion(successful.length, comparisons.length),
        bothDescriptionsPresentCount: bothDescriptionsPresent.length,
        bothDescriptionsMissingCount,
        searchDescriptionMissingCount,
        detailDescriptionMissingCount,
        descriptionComparableCount: comparableDescriptions.length,
        identicalCount,
        identicalProportion: this.proportion(identicalCount, comparableDescriptions.length),
        detailLongerCount,
        detailLongerProportion: this.proportion(detailLongerCount, successful.length),
        searchLongerCount,
        searchLongerProportion: this.proportion(searchLongerCount, successful.length),
        averageCharacterGain: this.average(gains),
        medianCharacterGain: this.median(gains),
        detailOnlyPathOccurrences: this.countPathOccurrences(successful, "detailOnlyPaths"),
        searchOnlyPathOccurrences: this.countPathOccurrences(successful, "searchOnlyPaths"),
      },
      offers: comparisons.map((comparison) => {
        return this.toSafeComparison(comparison);
      }),
    };
  }

  /**
   * Remove in-memory full normalized text from a comparison.
   * @param {object} comparison - Internal comparison.
   * @returns {object} Safe serializable comparison.
   */
  toSafeComparison(comparison) {
    return {
      ...comparison,
      searchDescription: this.toSafeDescription(comparison.searchDescription),
      detailDescription: this.toSafeDescription(comparison.detailDescription),
    };
  }

  /**
   * Remove full normalized text from description measurements.
   * @param {object} description - Internal measurements.
   * @returns {object} Safe measurements.
   */
  toSafeDescription(description) {
    const { normalizedText, ...safeDescription } = description;
    void normalizedText;
    return safeDescription;
  }

  /**
   * Count path occurrences across successful comparisons.
   * @param {object[]} comparisons - Successful comparisons.
   * @param {string} field - Business-field list to aggregate.
   * @returns {object} Occurrence counts keyed by path.
   */
  countPathOccurrences(comparisons, field) {
    const counts = new Map();
    for (const comparison of comparisons) {
      for (const path of comparison.businessFields[field]) {
        counts.set(path, (counts.get(path) ?? 0) + 1);
      }
    }
    return Object.fromEntries([...counts.entries()].sort(([left], [right]) => {
      return left.localeCompare(right);
    }));
  }

  /**
   * Group values by non-empty string identity.
   * @param {object[]} values - Values to group.
   * @param {(value: object) => unknown} selector - Identity selector.
   * @returns {Map<string, object[]>} Values grouped by identity.
   */
  groupByIdentity(values, selector) {
    const groups = new Map();
    for (const value of values) {
      const identity = selector(value);
      if (typeof identity !== "string" || identity.length === 0) {
        continue;
      }
      const group = groups.get(identity) ?? [];
      group.push(value);
      groups.set(identity, group);
    }
    return groups;
  }

  /**
   * Count values retained in grouped identities.
   * @param {Map<string, object[]>} groups - Identity groups.
   * @returns {number} Grouped value count.
   */
  countGroupedValues(groups) {
    return [...groups.values()].reduce((sum, group) => {
      return sum + group.length;
    }, 0);
  }

  /**
   * Extract a URL from any supported fetch input.
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
   * Compare URL origins and paths while ignoring query parameters.
   * @param {URL} left - Candidate URL.
   * @param {URL} right - Expected URL.
   * @returns {boolean} True when origins and paths match.
   */
  urlsMatch(left, right) {
    return left.origin === right.origin && left.pathname === right.pathname;
  }

  /**
   * Hash a value for safe exact comparisons.
   * @param {string} value - Value to hash.
   * @returns {string} Hexadecimal digest.
   */
  hash(value) {
    return createHash(FranceTravailDetailAuditConfig.HASH_ALGORITHM)
      .update(value)
      .digest(FranceTravailDetailAuditConfig.HASH_ENCODING);
  }

  /**
   * Count whitespace-separated words.
   * @param {string} value - Normalized text.
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
   * Calculate a safe proportion.
   * @param {number} numerator - Numerator.
   * @param {number} denominator - Denominator.
   * @returns {number|null} Proportion or null without a population.
   */
  proportion(numerator, denominator) {
    return denominator === 0 ? null : numerator / denominator;
  }

  /**
   * Calculate an arithmetic mean.
   * @param {number[]} values - Values.
   * @returns {number|null} Mean or null without values.
   */
  average(values) {
    if (values.length === 0) {
      return null;
    }
    return values.reduce((sum, value) => {
      return sum + value;
    }, 0) / values.length;
  }

  /**
   * Calculate a median.
   * @param {number[]} values - Values.
   * @returns {number|null} Median or null without values.
   */
  median(values) {
    if (values.length === 0) {
      return null;
    }
    const sorted = [...values].sort((left, right) => {
      return left - right;
    });
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) {
      return sorted[middle];
    }
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
}

export { FranceTravailDetailAudit };
