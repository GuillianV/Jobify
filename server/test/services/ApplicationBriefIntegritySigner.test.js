import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationBriefLimits } from "../../src/constants/ApplicationBriefLimits.js";
import { ApplicationBriefIntegritySigner } from "../../src/services/ApplicationBriefIntegritySigner.js";

const SECRET_A_VALUE = 1;
const SECRET_A = Buffer.alloc(ApplicationBriefIntegritySigner.SECRET_BYTES, SECRET_A_VALUE);
const SECRET_B = Buffer.alloc(
  ApplicationBriefIntegritySigner.SECRET_BYTES,
  SECRET_A_VALUE + 1,
);

/**
 * Build one representative complete ApplicationBrief JSON value.
 * @returns {object} Complete brief fixture.
 */
function createBrief() {
  const evidenceRef = { kind: "EXPERIENCE", itemId: "exp-1", field: "current" };
  return {
    schemaVersion: "application-brief-schema-v1",
    inputIdentity: {
      offer: {
        offerId: 1,
        analysisFingerprint: "a".repeat(ApplicationBriefLimits.SHA256_HEX_LENGTH),
        analysisSchemaVersion: "offer-analysis-schema-v1",
        analyzerPolicyVersion: "offer-analyzer-v1",
      },
      candidate: {
        fingerprint: "b".repeat(ApplicationBriefLimits.SHA256_HEX_LENGTH),
        schemaVersion: "candidate-dossier-schema-v1",
      },
    },
    requirementMatches: [{
      offerRef: { kind: "REQUIREMENT", index: 0 },
      state: "SUPPORTED",
      supportedFacets: [{ text: "React", evidenceRefs: [evidenceRef] }],
      notEvidencedFacets: [],
    }],
    evidenceFacts: [{ ref: evidenceRef, value: false }],
    emphasis: [{
      priority: "PRIMARY",
      offerRefs: [{ kind: "REQUIREMENT", index: 0 }],
      evidenceRefs: [evidenceRef],
      relevanceReason: "Relevant exact evidence",
    }],
    supportedClaims: [{
      claimType: "EXPERIENCE_FACT",
      offerRefs: [{ kind: "REQUIREMENT", index: 0 }],
      evidenceRefs: [evidenceRef],
    }],
    cautions: [
      {
        kind: "SCOPE_GENERALIZATION_UNSUPPORTED",
        offerRefs: [{ kind: "REQUIREMENT", index: 0 }],
        evidenceRefs: [evidenceRef],
      },
      {
        kind: "DURATION_UNSUPPORTED",
        offerRefs: [{ kind: "REQUIREMENT", index: 0 }],
        evidenceRefs: [evidenceRef],
      },
    ],
  };
}

test("signer authenticates an unchanged whole brief without mutation", () => {
  const signer = new ApplicationBriefIntegritySigner(SECRET_A);
  const brief = createBrief();
  const snapshot = structuredClone(brief);
  const token = signer.sign(brief);

  assert.match(token, /^v1\.[A-Za-z0-9_-]+$/u);
  assert.equal(signer.verify(brief, token), true);
  assert.deepEqual(brief, snapshot);
  assert.equal(brief.evidenceFacts[0].value, false);
});

test("recursive object insertion order is canonical while array order is semantic", () => {
  const signer = new ApplicationBriefIntegritySigner(SECRET_A);
  const brief = createBrief();
  const reorderedKeys = Object.fromEntries(Object.entries(brief).reverse());
  reorderedKeys.inputIdentity = Object.fromEntries(
    Object.entries(brief.inputIdentity).reverse(),
  );
  const token = signer.sign(brief);
  const reorderedArray = structuredClone(brief);
  reorderedArray.cautions.reverse();

  assert.equal(signer.verify(reorderedKeys, token), true);
  assert.equal(signer.verify(reorderedArray, token), false);
});

test("whole-brief signing rejects factual strategic claim and identity tampering", () => {
  const signer = new ApplicationBriefIntegritySigner(SECRET_A);
  const brief = createBrief();
  const token = signer.sign(brief);
  const mutations = [
    (candidate) => {
      candidate.evidenceFacts[0].value = true;
    },
    (candidate) => {
      candidate.cautions = [];
    },
    (candidate) => {
      candidate.emphasis[0].relevanceReason = "Changed";
    },
    (candidate) => {
      candidate.supportedClaims[0].claimType = "PROJECT_FACT";
    },
    (candidate) => {
      candidate.supportedClaims.push(structuredClone(candidate.supportedClaims[0]));
    },
    (candidate) => {
      candidate.supportedClaims = [];
    },
    (candidate) => {
      candidate.inputIdentity.offer.offerId = 2;
    },
  ];

  for (const mutate of mutations) {
    const candidate = structuredClone(brief);
    mutate(candidate);
    assert.equal(signer.verify(candidate, token), false);
  }
});

test("different process secrets reject previous tokens", () => {
  const first = new ApplicationBriefIntegritySigner(SECRET_A);
  const restarted = new ApplicationBriefIntegritySigner(SECRET_B);
  const brief = createBrief();
  const token = first.sign(brief);

  assert.equal(first.verify(brief, token), true);
  assert.equal(restarted.verify(brief, token), false);
});

test("constructor copies the caller-owned secret buffer", () => {
  const sourceSecret = Buffer.from(SECRET_A);
  const signer = new ApplicationBriefIntegritySigner(sourceSecret);
  const brief = createBrief();
  const token = signer.sign(brief);
  sourceSecret.fill(0);

  assert.equal(signer.verify(brief, token), true);
  assert.equal(
    new ApplicationBriefIntegritySigner(sourceSecret).verify(brief, token),
    false,
  );
});

test("ephemeral factory creates one process-lifetime signer", () => {
  const signer = ApplicationBriefIntegritySigner.createEphemeral();
  const brief = createBrief();
  const token = signer.sign(brief);

  assert.equal(signer.verify(brief, token), true);
});

test("token parsing rejects tampering wrong versions truncation garbage and types", () => {
  const signer = new ApplicationBriefIntegritySigner(SECRET_A);
  const brief = createBrief();
  const token = signer.sign(brief);
  const separatorIndex = token.indexOf(".");
  const macStart = separatorIndex + 1;
  const changedCharacter = token[macStart] === "A" ? "B" : "A";
  const invalidTokens = [
    `${token.slice(0, macStart)}${changedCharacter}${token.slice(macStart + 1)}`,
    token.replace(/^v1/u, "v2"),
    token.slice(0, -1),
    "garbage",
    "",
    null,
    1,
  ];

  for (const invalid of invalidTokens) {
    assert.equal(signer.verify(brief, invalid), false);
  }
});

test("signing domain and token version are explicit and distinct", () => {
  assert.equal(
    ApplicationBriefIntegritySigner.SIGNING_DOMAIN,
    "jobify.application-brief-generation",
  );
  assert.equal(
    ApplicationBriefIntegritySigner.TOKEN_VERSION,
    "application-brief-generation-token-v1",
  );
  assert.notEqual(
    ApplicationBriefIntegritySigner.TOKEN_VERSION,
    "cover-letter-generator-v1",
  );
});

test("unsupported values secrets and cyclic inputs fail closed", () => {
  assert.throws(() => {
    return new ApplicationBriefIntegritySigner(Buffer.alloc(
      ApplicationBriefIntegritySigner.SECRET_BYTES - 1,
    ));
  }, TypeError);
  const signer = new ApplicationBriefIntegritySigner(SECRET_A);
  const sparseArray = new Array(1);
  const extendedArray = [];
  extendedArray.external = true;
  for (const invalid of [
    undefined, BigInt(1), Number.NaN, Number.POSITIVE_INFINITY, -0,
    new Date(), new Map(), new Uint8Array([1]), sparseArray, extendedArray,
  ]) {
    assert.throws(() => {
      signer.sign(invalid);
    }, TypeError);
  }
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => {
    signer.sign(cyclic);
  }, TypeError);
});
