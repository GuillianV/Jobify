import test from "node:test";
import assert from "node:assert/strict";
import { OfferContent } from "../../src/models/OfferContent.js";
import { OfferContentAcquisition } from "../../src/constants/OfferContentAcquisition.js";
import { OfferContentCompleteness } from "../../src/constants/OfferContentCompleteness.js";

const FIRST_TIME = "2026-08-01T10:00:00.000Z";
const SECOND_TIME = "2026-08-02T10:00:00.000Z";
const INVALID_TIME = "invalid";

/**
 * Build automatic text with overridable merge metadata.
 * @param {object} [overrides] - Values replacing the defaults.
 * @returns {object} Automatic text candidate.
 */
function automaticText(overrides = {}) {
  return {
    value: "Provider text",
    acquisition: OfferContentAcquisition.SEARCH,
    retrievedAt: FIRST_TIME,
    completeness: OfferContentCompleteness.UNKNOWN,
    ...overrides,
  };
}

/**
 * Build structured content with overridable merge metadata.
 * @param {object} [overrides] - Values replacing the defaults.
 * @returns {object} Structured snapshot candidate.
 */
function structured(overrides = {}) {
  return {
    value: { skills: ["Node.js"] },
    acquisition: OfferContentAcquisition.SEARCH,
    retrievedAt: FIRST_TIME,
    ...overrides,
  };
}

test("OfferContent serializes and hydrates every persistent branch", () => {
  const content = new OfferContent({
    automaticText: automaticText(),
    userText: { value: "User text", providedAt: SECOND_TIME },
    structured: structured(),
  });
  const serialized = content.toPersistenceJson();
  const hydrated = OfferContent.fromPersistence(serialized);

  assert.deepEqual(hydrated.toPersistenceJson(), serialized);
  assert.notEqual(hydrated.structured.value, content.structured.value);
});

test("structured construction and hydration deeply detach their input", () => {
  const constructionValue = {
    skills: ["Node.js"],
    company: { sector: "Tech" },
  };
  const content = new OfferContent({
    structured: structured({ value: constructionValue }),
  });
  constructionValue.skills.push("JavaScript");
  constructionValue.company.sector = "Finance";

  assert.deepEqual(content.structured.value, {
    skills: ["Node.js"],
    company: { sector: "Tech" },
  });

  const persistentValue = {
    skills: ["Node.js"],
    company: { sector: "Tech" },
  };
  const payload = {
    structured: structured({ value: persistentValue }),
  };
  const hydrated = OfferContent.fromPersistence(payload);
  persistentValue.skills.push("TypeScript");
  persistentValue.company.sector = "Health";

  assert.deepEqual(hydrated.structured.value, {
    skills: ["Node.js"],
    company: { sector: "Tech" },
  });
});

test("structured serialization deeply detaches its returned value", () => {
  const content = new OfferContent({
    structured: structured({
      value: {
        skills: ["Node.js"],
        company: { sector: "Tech" },
      },
    }),
  });
  const serialized = content.toPersistenceJson();
  serialized.structured.value.skills.push("JavaScript");
  serialized.structured.value.company.sector = "Finance";

  assert.deepEqual(content.structured.value, {
    skills: ["Node.js"],
    company: { sector: "Tech" },
  });
});

test("structured merge deeply detaches snapshots selected from either input", () => {
  const existing = new OfferContent({
    structured: structured({
      value: {
        skills: ["Node.js"],
        company: { sector: "Tech" },
      },
    }),
  });
  const incoming = new OfferContent({
    structured: structured({
      value: {
        skills: ["TypeScript"],
        company: { sector: "Software" },
      },
      retrievedAt: SECOND_TIME,
    }),
  });
  const incomingSelected = existing.merge(incoming);
  incoming.structured.value.skills.push("JavaScript");
  incoming.structured.value.company.sector = "Finance";

  assert.deepEqual(incomingSelected.structured.value, {
    skills: ["TypeScript"],
    company: { sector: "Software" },
  });

  const emptyIncoming = new OfferContent();
  const existingSelected = existing.merge(emptyIncoming);
  existing.structured.value.skills.push("SQL");
  existing.structured.value.company.sector = "Health";

  assert.deepEqual(existingSelected.structured.value, {
    skills: ["Node.js"],
    company: { sector: "Tech" },
  });
});

test("OfferContent normalizes empty text, invalid metadata and empty snapshots", () => {
  const values = [null, undefined, "", "   "];
  for (const value of values) {
    const content = new OfferContent({
      automaticText: automaticText({ value }),
      userText: { value, providedAt: FIRST_TIME },
    });
    assert.equal(content.automaticText, null);
    assert.equal(content.userText, null);
  }
  assert.equal(new OfferContent({ structured: structured({ value: {} }) }).structured, null);
  assert.equal(new OfferContent({ structured: structured({ value: [] }) }).structured, null);
  assert.equal(new OfferContent({
    automaticText: automaticText({ acquisition: "OTHER" }),
  }).automaticText, null);
  assert.equal(new OfferContent({
    automaticText: automaticText({ completeness: "OTHER" }),
  }).automaticText, null);
});

test("effective text prefers user text while automatic text remains separate", () => {
  const content = new OfferContent({
    automaticText: automaticText(),
    userText: { value: "User text", providedAt: SECOND_TIME },
  });

  assert.equal(content.getAutomaticText(), "Provider text");
  assert.equal(content.getEffectiveText(), "User text");
  assert.equal(new OfferContent({ automaticText: automaticText() }).getEffectiveText(), "Provider text");
  assert.equal(new OfferContent().getEffectiveText(), null);
});

test("automatic merge applies every completeness priority", () => {
  const ascending = [
    OfferContentCompleteness.KNOWN_TRUNCATED,
    OfferContentCompleteness.UNKNOWN,
    OfferContentCompleteness.PROVIDER_FULL,
  ];
  for (const existingCompleteness of ascending) {
    for (const incomingCompleteness of ascending) {
      const existing = new OfferContent({
        automaticText: automaticText({
          value: `existing-${existingCompleteness}`,
          completeness: existingCompleteness,
        }),
      });
      const incoming = new OfferContent({
        automaticText: automaticText({
          value: `incoming-${incomingCompleteness}`,
          completeness: incomingCompleteness,
          retrievedAt: SECOND_TIME,
        }),
      });
      const result = existing.merge(incoming).automaticText;
      const incomingWins = ascending.indexOf(incomingCompleteness)
        > ascending.indexOf(existingCompleteness);
      const expected = incomingWins
        ? `incoming-${incomingCompleteness}`
        : existingCompleteness === incomingCompleteness
          ? `incoming-${incomingCompleteness}`
          : `existing-${existingCompleteness}`;
      assert.equal(result.value, expected);
    }
  }
});

test("automatic merge prefers DETAIL only at equal completeness", () => {
  const search = new OfferContent({
    automaticText: automaticText({ value: "search" }),
  });
  const detail = new OfferContent({
    automaticText: automaticText({
      value: "detail",
      acquisition: OfferContentAcquisition.DETAIL,
    }),
  });
  const truncatedDetail = new OfferContent({
    automaticText: automaticText({
      value: "truncated detail",
      acquisition: OfferContentAcquisition.DETAIL,
      completeness: OfferContentCompleteness.KNOWN_TRUNCATED,
      retrievedAt: SECOND_TIME,
    }),
  });

  assert.equal(search.merge(detail).getAutomaticText(), "detail");
  assert.equal(detail.merge(search).getAutomaticText(), "detail");
  assert.equal(search.merge(truncatedDetail).getAutomaticText(), "search");
});

test("automatic freshness handles newer, older, equal, absent and invalid dates", () => {
  const existing = new OfferContent({
    automaticText: automaticText({ value: "existing" }),
  });
  const candidates = [
    [SECOND_TIME, "incoming"],
    [FIRST_TIME, "existing"],
    [null, "existing"],
    [INVALID_TIME, "existing"],
  ];
  for (const [retrievedAt, expected] of candidates) {
    const incoming = new OfferContent({
      automaticText: automaticText({ value: "incoming", retrievedAt }),
    });
    assert.equal(existing.merge(incoming).getAutomaticText(), expected);
  }
  const undated = new OfferContent({
    automaticText: automaticText({ value: "undated", retrievedAt: null }),
  });
  assert.equal(undated.merge(existing).getAutomaticText(), "existing");
  assert.equal(undated.merge(new OfferContent({
    automaticText: automaticText({ value: "also undated", retrievedAt: INVALID_TIME }),
  })).getAutomaticText(), "undated");
});

test("automatic merge is idempotent and empty incoming text is non-destructive", () => {
  const content = new OfferContent({ automaticText: automaticText() });
  const empty = new OfferContent({ automaticText: automaticText({ value: " " }) });

  assert.deepEqual(content.merge(content).toPersistenceJson(), content.toPersistenceJson());
  assert.equal(content.merge(empty).getAutomaticText(), "Provider text");
});

test("structured merge replaces snapshots atomically by channel and freshness", () => {
  const existing = new OfferContent({ structured: structured({ value: { first: true } }) });
  const newer = new OfferContent({
    structured: structured({ value: { second: true }, retrievedAt: SECOND_TIME }),
  });
  const detail = new OfferContent({
    structured: structured({
      value: { detail: true },
      acquisition: OfferContentAcquisition.DETAIL,
    }),
  });

  assert.deepEqual(existing.merge(newer).structured.value, { second: true });
  assert.deepEqual(existing.merge(detail).structured.value, { detail: true });
  assert.deepEqual(detail.merge(newer).structured.value, { detail: true });
  assert.deepEqual(existing.merge(new OfferContent({
    structured: structured({ value: {} }),
  })).structured.value, { first: true });
  assert.deepEqual(existing.merge(new OfferContent({
    structured: structured({ value: { equal: true } }),
  })).structured.value, { first: true });
});

test("automatic merge never modifies existing user text", () => {
  const existing = new OfferContent({
    automaticText: automaticText(),
    userText: { value: "Existing user text", providedAt: FIRST_TIME },
  });
  const incoming = new OfferContent({
    automaticText: automaticText({ value: "New provider text", retrievedAt: SECOND_TIME }),
    userText: { value: "Incoming user text", providedAt: SECOND_TIME },
  });
  const merged = existing.merge(incoming);

  assert.equal(merged.getAutomaticText(), "New provider text");
  assert.equal(merged.getEffectiveText(), "Existing user text");
});

test("withUserText replaces user text immutably and preserves automatic and structured content", () => {
  const existing = new OfferContent({
    automaticText: automaticText(),
    userText: { value: "Existing user text", providedAt: FIRST_TIME },
    structured: structured(),
  });
  const before = existing.toPersistenceJson();
  const replaced = existing.withUserText(" Replacement text ", SECOND_TIME);

  assert.equal(replaced.userText.value, " Replacement text ");
  assert.equal(replaced.userText.providedAt, SECOND_TIME);
  assert.deepEqual(replaced.automaticText, existing.automaticText);
  assert.deepEqual(replaced.structured, existing.structured);
  assert.notEqual(replaced.structured.value, existing.structured.value);
  assert.deepEqual(existing.toPersistenceJson(), before);
});
