const test = require("node:test");
const assert = require("node:assert/strict");
const {
  HelloWorkDetailAcquisition,
} = require("../../electron/scrapers/HelloWorkDetailAcquisition.cjs");
const {
  HelloWorkDetailAcquisitionConstants,
} = require("../../electron/scrapers/HelloWorkDetailAcquisitionConstants.cjs");

const ALLOWED_URL = "https://www.hellowork.com/fr-fr/emplois/123.html";

/**
 * Build one supported provider instruction.
 * @param {object} [overrides] - Values replacing instruction defaults.
 * @returns {object} Provider instruction.
 */
function createInstruction(overrides = {}) {
  return {
    kind: HelloWorkDetailAcquisitionConstants.KIND,
    source: HelloWorkDetailAcquisitionConstants.SOURCE,
    url: ALLOWED_URL,
    ...overrides,
  };
}

/**
 * Create an adapter with observable scraper and URL policy dependencies.
 * @param {Function} fetchDetail - Fake secured scraper operation.
 * @returns {{acquisition: HelloWorkDetailAcquisition, calls: object}} Test context.
 */
function createAcquisition(fetchDetail) {
  const calls = { scraper: 0, policy: [] };
  const scraper = {
    async fetchDetail(url) {
      calls.scraper += 1;
      return fetchDetail(url);
    },
  };
  const urlPolicy = {
    isAllowed(url) {
      calls.policy.push(url);
      return url === ALLOWED_URL;
    },
  };
  return {
    acquisition: new HelloWorkDetailAcquisition(scraper, urlPolicy, { warn() {} }),
    calls,
  };
}

test("valid DETAIL maps to the exact ACQUIRED public result", async () => {
  const detail = {
    description: "DETAIL",
    sourceUrl: ALLOWED_URL,
    salary: { raw: "internal" },
  };
  const { acquisition, calls } = createAcquisition(async () => {
    return detail;
  });

  const result = await acquisition.acquire(createInstruction());

  assert.deepEqual(result, {
    status: HelloWorkDetailAcquisitionConstants.STATUS.ACQUIRED,
    detail: { description: "DETAIL", sourceUrl: ALLOWED_URL },
  });
  assert.equal(calls.scraper, 1);
  assert.deepEqual(calls.policy, [ALLOWED_URL, ALLOWED_URL]);
});

test("absent scraper DETAIL maps to the exact NOT_FOUND result", async () => {
  const { acquisition } = createAcquisition(async () => {
    return null;
  });

  assert.deepEqual(await acquisition.acquire(createInstruction()), {
    status: HelloWorkDetailAcquisitionConstants.STATUS.NOT_FOUND,
  });
});

test("scraper exceptions map to FAILED without exposing error details", async () => {
  const { acquisition } = createAcquisition(async () => {
    throw new Error("Sensitive internal failure");
  });

  const result = await acquisition.acquire(createInstruction());

  assert.deepEqual(result, { status: HelloWorkDetailAcquisitionConstants.STATUS.FAILED });
  assert.equal(Object.hasOwn(result, "message"), false);
  assert.equal(Object.hasOwn(result, "stack"), false);
  assert.equal(Object.hasOwn(result, "error"), false);
});

test("invalid kind source and URL fail before the secured scraper is called", async () => {
  const { acquisition, calls } = createAcquisition(async () => {
    throw new Error("Scraper must not run");
  });
  const invalidInstructions = [
    createInstruction({ kind: "UNKNOWN" }),
    createInstruction({ source: "unknown" }),
    createInstruction({ url: "https://example.com/offer" }),
  ];

  for (const instruction of invalidInstructions) {
    assert.deepEqual(await acquisition.acquire(instruction), {
      status: HelloWorkDetailAcquisitionConstants.STATUS.FAILED,
    });
  }

  assert.equal(calls.scraper, 0);
  assert.deepEqual(calls.policy, ["https://example.com/offer"]);
});
