import test from "node:test";
import assert from "node:assert/strict";
import { CareerjetFragmentSizeAudit } from "../../scripts/careerjet-fragment-size/CareerjetFragmentSizeAudit.js";
import { CareerjetFragmentSizeAuditConfig } from "../../scripts/careerjet-fragment-size/CareerjetFragmentSizeAuditConfig.js";

const EXPECTED_VARIANTS = Object.freeze([null, 120, 500, 1000, 3000, 5000, 10000]);
const CONTROL_FRAGMENT_SIZE = null;
const FIRST_FRAGMENT_SIZE = 500;
const SECOND_FRAGMENT_SIZE = 1000;
const AMBIGUOUS_OFFER_COUNT = 2;
const SINGLE_AMBIGUOUS_IDENTITY = 1;
const EXPECTED_COMMON_OFFER_COUNT = 1;
const EXPECTED_SUCCESSFUL_VARIANT_COUNT = 3;
const EXPECTED_MAXIMUM_LENGTH = 8;
const EXPECTED_CONTROL_LENGTH = 1;
const EXPECTED_EXPANDED_LENGTH = 8;
const EXPECTED_GAIN = 7;
const FULL_PROPORTION = 1;
const OFFER_ID = "opaque-offer-id";
const FIRST_URL = "https://example.test/first";
const SECOND_URL = "https://example.test/second";
const PUBLISHED_AT = "2026-08-01T10:00:00.000Z";

/**
 * Build an audit whose fetch dependency fails if a test accidentally performs
 * a network request.
 * @returns {CareerjetFragmentSizeAudit} Offline audit instance.
 */
function createAudit() {
  return new CareerjetFragmentSizeAudit({
    connector: {},
    criteria: {},
    outputPath: "ignored.json",
    affiliateId: "test-affiliate",
    fetchImplementation: async () => {
      throw new Error("Network access is forbidden in this test");
    },
  });
}

/**
 * Build one successful synthetic variant for comparison calculations.
 * @param {number|null} fragmentSize - Tested fragment size.
 * @param {string} description - Normalized description.
 * @returns {object} Variant capture.
 */
function createVariant(fragmentSize, description) {
  return {
    fragmentSize,
    label: CareerjetFragmentSizeAuditConfig.getVariantLabel(fragmentSize),
    success: true,
    offers: [{
      offerId: OFFER_ID,
      title: "Developer",
      normalizedDescription: description,
      normalizedDescriptionLength: description.length,
      descriptionHash: createAudit().hash(description),
    }],
  };
}

test("configuration exposes the audited fragment-size sequence and stable labels", () => {
  assert.deepEqual(CareerjetFragmentSizeAuditConfig.FRAGMENT_VARIANTS, EXPECTED_VARIANTS);
  assert.equal(
    CareerjetFragmentSizeAuditConfig.getVariantLabel(CONTROL_FRAGMENT_SIZE),
    "control",
  );
  assert.equal(
    CareerjetFragmentSizeAuditConfig.getVariantLabel(FIRST_FRAGMENT_SIZE),
    String(FIRST_FRAGMENT_SIZE),
  );
  assert.equal(Object.isFrozen(CareerjetFragmentSizeAuditConfig.FRAGMENT_VARIANTS), true);
});

test("inter-variant identity ignores URLs and ambiguous composites are excluded", () => {
  const audit = createAudit();
  const baseOffer = {
    title: "Développeur Backend",
    company: { name: "Example Tech" },
    location: { label: "Annecy, Haute-Savoie" },
    publishedAt: PUBLISHED_AT,
  };
  const firstOffer = {
    ...baseOffer,
    sourceId: FIRST_URL,
    description: "First description",
  };
  const secondOffer = {
    ...baseOffer,
    sourceId: SECOND_URL,
    description: "Second description",
  };

  assert.equal(
    audit.buildInterVariantIdentity(firstOffer),
    audit.buildInterVariantIdentity(secondOffer),
  );
  assert.equal(audit.buildInterVariantIdentity({ title: "Developer" }), null);

  const capture = {
    missingInterVariantIdentityCount: 0,
    ambiguousInterVariantIdentityCount: 0,
    offersWithAmbiguousInterVariantIdentityCount: 0,
    nonComparableRawJobCount: 0,
    nonComparableOfferCount: 0,
  };
  const measurements = audit.measureOffers(
    [
      { url: FIRST_URL, description: firstOffer.description },
      { url: SECOND_URL, description: secondOffer.description },
    ],
    [firstOffer, secondOffer],
    capture,
  );

  assert.deepEqual(measurements, []);
  assert.equal(capture.ambiguousInterVariantIdentityCount, SINGLE_AMBIGUOUS_IDENTITY);
  assert.equal(
    capture.offersWithAmbiguousInterVariantIdentityCount,
    AMBIGUOUS_OFFER_COUNT,
  );
});

test("comparisons identify common offers, gains, maxima and a stable plateau", () => {
  const audit = createAudit();
  const variants = [
    createVariant(CONTROL_FRAGMENT_SIZE, "a"),
    createVariant(FIRST_FRAGMENT_SIZE, "expanded"),
    createVariant(SECOND_FRAGMENT_SIZE, "expanded"),
  ];
  const commonOfferIds = audit.findCommonOfferIds(variants);
  const comparisons = audit.buildCommonOfferComparisons(variants, commonOfferIds);
  const global = audit.buildGlobalSummary(variants, commonOfferIds);

  assert.deepEqual(commonOfferIds, [OFFER_ID]);
  assert.equal(comparisons[0].maximumObservedNormalizedLength, EXPECTED_MAXIMUM_LENGTH);
  assert.equal(comparisons[0].plateauFrom, FIRST_FRAGMENT_SIZE);
  assert.equal(
    comparisons[0].variants[0].normalizedDescriptionLength,
    EXPECTED_CONTROL_LENGTH,
  );
  assert.equal(comparisons[0].variants[1].lengthChangeFromControl, EXPECTED_GAIN);
  assert.equal(comparisons[0].variants[2].identicalToControl, false);
  assert.equal(global.successfulVariantCount, EXPECTED_SUCCESSFUL_VARIANT_COUNT);
  assert.equal(global.commonOfferCount, EXPECTED_COMMON_OFFER_COUNT);
  assert.equal(global.variants[1].averageNormalizedLength, EXPECTED_EXPANDED_LENGTH);
  assert.equal(global.variants[1].observedMaximumReachedProportion, FULL_PROPORTION);
  assert.equal(global.firstVariantCoveringAtLeast95PercentOfObservedMaxima, FIRST_FRAGMENT_SIZE);
});
