import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { CareerjetConstants } from "../../src/constants/CareerjetConstants.js";
import { TextNormalizer } from "../../src/normalization/TextNormalizer.js";
import { CareerjetFragmentSizeAuditConfig } from "./CareerjetFragmentSizeAuditConfig.js";

const FRAGMENT_SIZE_PARAMETER = "fragment_size";
const ELLIPSIS_AT_END_PATTERN = /(?:\.\.\.|…)\s*$/u;
const WORD_SEPARATOR_PATTERN = /\s+/u;
const REDACTED_VALUE = "[REDACTED]";
const REQUEST_FAILURE = "REQUEST_FAILED";
const PAYLOAD_FAILURE = "CAREERJET_PAYLOAD_ERROR";
const INVALID_RESPONSE_FAILURE = "INVALID_RESPONSE";
const UNKNOWN_STATUS = null;

/**
 * Run and report the temporary Careerjet fragment-size experiment.
 */
class CareerjetFragmentSizeAudit {
  /**
   * Create the audit with production connector dependencies.
   * @param {object} dependencies - Runtime dependencies.
   * @param {import("../../src/connectors/CareerjetConnector.js").CareerjetConnector} dependencies.connector - Production Careerjet connector.
   * @param {import("../../src/models/SearchCriteria.js").SearchCriteria} dependencies.criteria - Search criteria.
   * @param {string} dependencies.outputPath - Explicit report destination.
   * @param {string} dependencies.affiliateId - Secret used only for output redaction.
   * @param {typeof fetch} dependencies.fetchImplementation - Original fetch implementation.
   */
  constructor({ connector, criteria, outputPath, affiliateId, fetchImplementation }) {
    this.connector = connector;
    this.criteria = criteria;
    this.outputPath = outputPath;
    this.affiliateId = affiliateId;
    this.fetchImplementation = fetchImplementation;
    this.endpoint = new URL(CareerjetConstants.SEARCH_ENDPOINT);
  }

  /**
   * Execute every variant, analyze common offers and write the JSON report.
   * @returns {Promise<void>} Resolves after the report has been written.
   */
  async run() {
    const variants = [];
    for (const fragmentSize of CareerjetFragmentSizeAuditConfig.FRAGMENT_VARIANTS) {
      variants.push(await this.runVariant(fragmentSize));
    }
    const commonOfferIds = this.findCommonOfferIds(variants);
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      methodology: {
        intraVariantMatching: "unique in-memory equality between raw.url and JobOffer.sourceId",
        interVariantIdentity: "SHA-256 of JSON [version, normalized title, normalized company, normalized location label, canonical ISO publication date]",
        ambiguousIdentityPolicy: "identities occurring more than once within a variant are excluded entirely",
        normalizedDescription: "TextNormalizer.htmlToPlainText(raw.description)",
        lengths: "JavaScript UTF-16 code units",
        globalStatisticsPopulation: "offers with unique composite identities present in every successful variant",
        failedVariants: "reported but excluded from common-offer and aggregate calculations",
        controlGains: "calculated only when the control variant succeeded",
        plateau: "calculated only when every requested variant succeeded; otherwise null",
        maximum: "greatest normalized-description length observed among successful variants",
        excerptsMaximumCharacters: CareerjetFragmentSizeAuditConfig.EXCERPT_LENGTH,
      },
      variants: variants.map((variant) => {
        return this.toReportVariant(variant, commonOfferIds);
      }),
      commonOffers: this.buildCommonOfferComparisons(variants, commonOfferIds),
      global: this.buildGlobalSummary(variants, commonOfferIds),
    };
    const serializedReport = JSON.stringify(report, null, CareerjetFragmentSizeAuditConfig.REPORT_INDENTATION);
    await writeFile(this.outputPath, serializedReport, "utf8");
  }

  /**
   * Execute one connector search while instrumenting only the Careerjet request.
   * @param {number|null} fragmentSize - Fragment size, or null for the control.
   * @returns {Promise<object>} Captured variant data.
   */
  async runVariant(fragmentSize) {
    const capture = {
      fragmentSize,
      label: CareerjetFragmentSizeAuditConfig.getVariantLabel(fragmentSize),
      success: false,
      httpStatus: UNKNOWN_STATUS,
      responseOk: false,
      rawJobs: [],
      payloadError: false,
      failure: null,
      offers: [],
      resultCount: 0,
      nonComparableRawJobCount: 0,
      nonComparableOfferCount: 0,
      missingInterVariantIdentityCount: 0,
      ambiguousInterVariantIdentityCount: 0,
      offersWithAmbiguousInterVariantIdentityCount: 0,
    };
    const originalGlobalFetch = globalThis.fetch;
    globalThis.fetch = this.createInstrumentedFetch(fragmentSize, capture);
    try {
      const offers = await this.connector.search(this.criteria);
      capture.success = true;
      capture.resultCount = offers.length;
      capture.offers = this.measureOffers(capture.rawJobs, offers, capture);
    } catch {
      capture.failure = this.classifyFailure(capture);
    } finally {
      globalThis.fetch = originalGlobalFetch;
    }
    return capture;
  }

  /**
   * Create a fetch wrapper that modifies only the known Careerjet endpoint.
   * @param {number|null} fragmentSize - Fragment size, or null for control.
   * @param {object} capture - Mutable request capture.
   * @returns {typeof fetch} Instrumented fetch function.
   */
  createInstrumentedFetch(fragmentSize, capture) {
    return async (input, init) => {
      const requestUrl = this.extractRequestUrl(input);
      if (!this.isCareerjetEndpoint(requestUrl)) {
        throw new Error("Unexpected network request blocked by Careerjet audit");
      }
      if (fragmentSize === null) {
        requestUrl.searchParams.delete(FRAGMENT_SIZE_PARAMETER);
      } else {
        requestUrl.searchParams.set(FRAGMENT_SIZE_PARAMETER, String(fragmentSize));
      }
      const response = await this.fetchImplementation(requestUrl, init);
      capture.httpStatus = response.status;
      capture.responseOk = response.ok;
      if (response.ok) {
        try {
          const payload = await response.clone().json();
          capture.payloadError = payload?.type === CareerjetConstants.ERROR_TYPE;
          capture.rawJobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
        } catch {
          capture.failure = INVALID_RESPONSE_FAILURE;
        }
      }
      return response;
    };
  }

  /**
   * Extract a URL without retaining or reporting its serialized form.
   * @param {RequestInfo|URL} input - Fetch input.
   * @returns {URL} Parsed request URL.
   */
  extractRequestUrl(input) {
    if (input instanceof Request) {
      return new URL(input.url);
    }
    return new URL(input.toString());
  }

  /**
   * Confirm that instrumentation applies only to the production endpoint.
   * @param {URL} requestUrl - Candidate request URL.
   * @returns {boolean} True for the configured Careerjet endpoint.
   */
  isCareerjetEndpoint(requestUrl) {
    return requestUrl.origin === this.endpoint.origin && requestUrl.pathname === this.endpoint.pathname;
  }

  /**
   * Convert matching raw and canonical offers into safe objective measurements.
   * @param {object[]} rawJobs - Raw jobs observed from the response clone.
   * @param {object[]} offers - Canonical connector results.
   * @param {object} capture - Mutable variant capture.
   * @returns {object[]} Safe offer measurements.
   */
  measureOffers(rawJobs, offers, capture) {
    const candidates = [];
    const rawJobsByUrl = this.groupByIdentity(rawJobs, (raw) => {
      return raw?.url;
    });
    const offersBySourceId = this.groupByIdentity(offers, (offer) => {
      return offer?.sourceId;
    });
    let matchedCount = 0;
    for (const [url, matchingRawJobs] of rawJobsByUrl) {
      const matchingOffers = offersBySourceId.get(url) ?? [];
      if (matchingRawJobs.length !== 1 || matchingOffers.length !== 1) {
        continue;
      }
      const raw = matchingRawJobs[0];
      const offer = matchingOffers[0];
      const rawDescription = typeof raw.description === "string" ? raw.description : "";
      const normalizedDescription = offer.description ?? "";
      const safeNormalizedDescription = this.redactSecret(normalizedDescription);
      matchedCount += 1;
      const offerId = this.buildInterVariantIdentity(offer);
      if (!offerId) {
        capture.missingInterVariantIdentityCount += 1;
        continue;
      }
      candidates.push({
        offerId,
        title: this.redactSecret(offer.title ?? ""),
        normalizedDescription,
        rawDescriptionLength: rawDescription.length,
        normalizedDescriptionLength: normalizedDescription.length,
        wordCount: this.countWords(normalizedDescription),
        rawDescriptionHash: this.hash(rawDescription),
        descriptionHash: this.hash(normalizedDescription),
        beginning: safeNormalizedDescription.slice(0, CareerjetFragmentSizeAuditConfig.EXCERPT_LENGTH),
        end: safeNormalizedDescription.slice(-CareerjetFragmentSizeAuditConfig.EXCERPT_LENGTH),
        rawEndsWithEllipsis: ELLIPSIS_AT_END_PATTERN.test(rawDescription),
        endsWithEllipsis: ELLIPSIS_AT_END_PATTERN.test(normalizedDescription),
      });
    }
    capture.nonComparableRawJobCount = rawJobs.length - matchedCount;
    capture.nonComparableOfferCount = offers.length - matchedCount;
    const candidatesByIdentity = this.groupByIdentity(candidates, (candidate) => {
      return candidate.offerId;
    });
    const measurements = [];
    for (const matchingCandidates of candidatesByIdentity.values()) {
      if (matchingCandidates.length === 1) {
        measurements.push(matchingCandidates[0]);
      } else {
        capture.ambiguousInterVariantIdentityCount += 1;
        capture.offersWithAmbiguousInterVariantIdentityCount += matchingCandidates.length;
      }
    }
    return measurements;
  }

  /**
   * Build a stable inter-variant identity without using the Careerjet URL.
   * @param {object} offer - Canonical Careerjet offer.
   * @returns {string|null} Hashed composite identity, or null without enough stable fields.
   */
  buildInterVariantIdentity(offer) {
    const title = TextNormalizer.normalize(offer?.title);
    const company = TextNormalizer.normalize(offer?.company?.name);
    const location = TextNormalizer.normalize(offer?.location?.label);
    const publishedAt = this.normalizePublishedAt(offer?.publishedAt);
    if (!title || (!company && !location && !publishedAt)) {
      return null;
    }
    const composite = JSON.stringify([
      "careerjet-fragment-audit-v1",
      title,
      company,
      location,
      publishedAt,
    ]);
    return this.hash(composite);
  }

  /**
   * Canonicalize a publication date as a locale-independent ISO UTC string.
   * @param {unknown} value - Canonical offer publication date.
   * @returns {string} ISO publication date, or an empty string when unavailable or invalid.
   */
  normalizePublishedAt(value) {
    if (!value) {
      return "";
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toISOString();
  }

  /**
   * Group objects by a usable string identity while retaining identities only in memory.
   * @param {object[]} values - Values to group.
   * @param {(value: object) => unknown} identitySelector - Identity accessor.
   * @returns {Map<string, object[]>} Values grouped by non-empty string identity.
   */
  groupByIdentity(values, identitySelector) {
    const groups = new Map();
    for (const value of values) {
      const identity = identitySelector(value);
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
   * Remove the configured affiliate value from any reportable external text.
   * @param {unknown} value - Candidate report text.
   * @returns {string} Redacted text.
   */
  redactSecret(value) {
    const text = String(value);
    if (!this.affiliateId) {
      return text;
    }
    return text.split(this.affiliateId).join(REDACTED_VALUE);
  }

  /**
   * Hash a value without retaining its original representation in the report.
   * @param {string} value - Value to hash.
   * @returns {string} Hexadecimal SHA-256 digest.
   */
  hash(value) {
    return createHash(CareerjetFragmentSizeAuditConfig.HASH_ALGORITHM)
      .update(value)
      .digest(CareerjetFragmentSizeAuditConfig.HASH_ENCODING);
  }

  /**
   * Count whitespace-separated words in normalized text.
   * @param {string} value - Normalized description.
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
   * Classify failures without serializing exception text or response bodies.
   * @param {object} capture - Request capture.
   * @returns {string} Safe failure category.
   */
  classifyFailure(capture) {
    if (capture.payloadError) {
      return PAYLOAD_FAILURE;
    }
    return capture.failure ?? REQUEST_FAILURE;
  }

  /**
   * Find opaque identities present in every successful variant.
   * @param {object[]} variants - Variant captures.
   * @returns {string[]} Sorted common offer hashes.
   */
  findCommonOfferIds(variants) {
    const successfulVariants = variants.filter((variant) => {
      return variant.success;
    });
    if (successfulVariants.length === 0) {
      return [];
    }
    const [firstVariant, ...remainingVariants] = successfulVariants;
    const commonIds = new Set(firstVariant.offers.map((offer) => {
      return offer.offerId;
    }));
    for (const variant of remainingVariants) {
      const variantIds = new Set(variant.offers.map((offer) => {
        return offer.offerId;
      }));
      for (const offerId of commonIds) {
        if (!variantIds.has(offerId)) {
          commonIds.delete(offerId);
        }
      }
    }
    return [...commonIds].sort();
  }

  /**
   * Convert internal capture state to a safe report variant.
   * @param {object} variant - Internal variant capture.
   * @param {string[]} commonOfferIds - Common opaque identities.
   * @returns {object} Serializable variant report.
   */
  toReportVariant(variant, commonOfferIds) {
    const commonIdSet = new Set(commonOfferIds);
    return {
      fragmentSize: variant.fragmentSize,
      label: variant.label,
      success: variant.success,
      httpStatus: variant.httpStatus,
      resultCount: variant.success ? variant.resultCount : 0,
      measuredOfferCount: variant.offers.length,
      nonComparableRawJobCount: variant.nonComparableRawJobCount,
      nonComparableOfferCount: variant.nonComparableOfferCount,
      missingInterVariantIdentityCount: variant.missingInterVariantIdentityCount,
      ambiguousInterVariantIdentityCount: variant.ambiguousInterVariantIdentityCount,
      offersWithAmbiguousInterVariantIdentityCount: variant.offersWithAmbiguousInterVariantIdentityCount,
      failure: variant.failure,
      offers: variant.offers.map((offer) => {
        return this.toSafeOfferMeasurement(offer);
      }),
      commonDescriptionStatistics: this.buildLengthStatistics(variant.offers.filter((offer) => {
        return commonIdSet.has(offer.offerId);
      })),
    };
  }

  /**
   * Remove internal full text before serializing an offer measurement.
   * @param {object} offer - Internal offer measurement.
   * @returns {object} Report-safe measurement.
   */
  toSafeOfferMeasurement(offer) {
    const { normalizedDescription, ...safeOffer } = offer;
    void normalizedDescription;
    return safeOffer;
  }

  /**
   * Build comparable length statistics for a collection of offers.
   * @param {object[]} offers - Offer measurements.
   * @returns {object|null} Mean and median lengths, or null without data.
   */
  buildLengthStatistics(offers) {
    if (offers.length === 0) {
      return null;
    }
    const lengths = offers.map((offer) => {
      return offer.normalizedDescriptionLength;
    });
    return {
      averageNormalizedLength: this.average(lengths),
      medianNormalizedLength: this.median(lengths),
    };
  }

  /**
   * Build per-offer comparisons across all variants.
   * @param {object[]} variants - Variant captures.
   * @param {string[]} commonOfferIds - Common opaque identities.
   * @returns {object[]} Offer comparison records.
   */
  buildCommonOfferComparisons(variants, commonOfferIds) {
    const successfulVariants = variants.filter((variant) => {
      return variant.success;
    });
    const indexedVariants = successfulVariants.map((variant) => {
      const offerIndex = new Map(variant.offers.map((offer) => {
        return [offer.offerId, offer];
      }));
      return { variant, offerIndex };
    });
    const controlEntry = indexedVariants.find(({ variant }) => {
      return variant.fragmentSize === null;
    });
    const canEstablishPlateau = successfulVariants.length === variants.length;
    return commonOfferIds.map((offerId) => {
      const offers = indexedVariants.map(({ offerIndex }) => {
        return offerIndex.get(offerId);
      });
      const control = controlEntry?.offerIndex.get(offerId) ?? null;
      const maximumLength = Math.max(...offers.map((offer) => {
        return offer.normalizedDescriptionLength;
      }));
      return {
        offerId,
        title: control?.title ?? offers[0].title,
        maximumObservedNormalizedLength: maximumLength,
        plateauFrom: canEstablishPlateau ? this.findPlateau(successfulVariants, offers) : null,
        variants: successfulVariants.map((variant, index) => {
          const offer = offers[index];
          return {
            label: variant.label,
            normalizedDescriptionLength: offer.normalizedDescriptionLength,
            lengthChangeFromControl: control
              ? offer.normalizedDescriptionLength - control.normalizedDescriptionLength
              : null,
            identicalToControl: control
              ? offer.normalizedDescription === control.normalizedDescription
              : null,
            reachesObservedMaximumLength: offer.normalizedDescriptionLength === maximumLength,
            descriptionHash: offer.descriptionHash,
          };
        }),
      };
    });
  }

  /**
   * Find the smallest numeric size whose text equals every higher tested size.
   * @param {object[]} variants - Variant captures.
   * @param {object[]} offers - One offer measurement per variant.
   * @returns {number|null} Plateau start, or null when none exists.
   */
  findPlateau(variants, offers) {
    for (let startIndex = 1; startIndex < variants.length; startIndex += 1) {
      const expectedDescription = offers[startIndex].normalizedDescription;
      const higherAreIdentical = offers.slice(startIndex).every((offer) => {
        return offer.normalizedDescription === expectedDescription;
      });
      if (higherAreIdentical) {
        return variants[startIndex].fragmentSize;
      }
    }
    return null;
  }

  /**
   * Build aggregate comparison metrics across common offers.
   * @param {object[]} variants - Variant captures.
   * @param {string[]} commonOfferIds - Common opaque identities.
   * @returns {object} Global summary.
   */
  buildGlobalSummary(variants, commonOfferIds) {
    const successfulVariants = variants.filter((variant) => {
      return variant.success;
    });
    if (commonOfferIds.length === 0) {
      return {
        successfulVariantCount: successfulVariants.length,
        commonOfferCount: 0,
        variants: successfulVariants.map((variant) => {
          return this.buildEmptyVariantSummary(variant);
        }),
        maximumReachedProportions: null,
        firstVariantCoveringAtLeast95PercentOfObservedMaxima: null,
      };
    }
    const indexes = successfulVariants.map((variant) => {
      return new Map(variant.offers.map((offer) => {
        return [offer.offerId, offer];
      }));
    });
    const controlVariantIndex = successfulVariants.findIndex((variant) => {
      return variant.fragmentSize === null;
    });
    const controlIndex = controlVariantIndex === -1 ? null : indexes[controlVariantIndex];
    const maxima = new Map(commonOfferIds.map((offerId) => {
      const maximum = Math.max(...indexes.map((index) => {
        return index.get(offerId).normalizedDescriptionLength;
      }));
      return [offerId, maximum];
    }));
    const variantSummaries = successfulVariants.map((variant, index) => {
      const lengths = [];
      const gains = [];
      let increasedCount = 0;
      let maximumCount = 0;
      for (const offerId of commonOfferIds) {
        const length = indexes[index].get(offerId).normalizedDescriptionLength;
        lengths.push(length);
        if (controlIndex) {
          const controlLength = controlIndex.get(offerId).normalizedDescriptionLength;
          const gain = length - controlLength;
          gains.push(gain);
          if (gain > 0) {
            increasedCount += 1;
          }
        }
        if (length === maxima.get(offerId)) {
          maximumCount += 1;
        }
      }
      return {
        fragmentSize: variant.fragmentSize,
        label: variant.label,
        averageNormalizedLength: this.average(lengths),
        medianNormalizedLength: this.median(lengths),
        descriptionsIncreasedProportion: controlIndex
          ? increasedCount / commonOfferIds.length
          : null,
        averageGainFromControl: controlIndex ? this.average(gains) : null,
        medianGainFromControl: controlIndex ? this.median(gains) : null,
        observedMaximumReachedProportion: maximumCount / commonOfferIds.length,
      };
    });
    const numericSummaries = variantSummaries.filter((summary) => {
      return summary.fragmentSize !== null;
    });
    const coverage = numericSummaries.find((summary) => {
      return summary.observedMaximumReachedProportion >= CareerjetFragmentSizeAuditConfig.MAXIMUM_COVERAGE_RATIO;
    });
    return {
      successfulVariantCount: successfulVariants.length,
      commonOfferCount: commonOfferIds.length,
      variants: variantSummaries,
      maximumReachedProportions: Object.fromEntries(numericSummaries.map((summary) => {
        return [summary.label, summary.observedMaximumReachedProportion];
      })),
      firstVariantCoveringAtLeast95PercentOfObservedMaxima: coverage ? Number(coverage.label) : null,
    };
  }

  /**
   * Build an explicitly empty summary when no common population exists.
   * @param {object} variant - Successful variant capture.
   * @returns {object} Empty aggregate summary.
   */
  buildEmptyVariantSummary(variant) {
    return {
      fragmentSize: variant.fragmentSize,
      label: variant.label,
      averageNormalizedLength: null,
      medianNormalizedLength: null,
      descriptionsIncreasedProportion: null,
      averageGainFromControl: null,
      medianGainFromControl: null,
      observedMaximumReachedProportion: null,
    };
  }

  /**
   * Calculate the arithmetic mean.
   * @param {number[]} values - Numeric values.
   * @returns {number} Arithmetic mean.
   */
  average(values) {
    return values.reduce((sum, value) => {
      return sum + value;
    }, 0) / values.length;
  }

  /**
   * Calculate the median.
   * @param {number[]} values - Numeric values.
   * @returns {number} Median value.
   */
  median(values) {
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

export { CareerjetFragmentSizeAudit };
