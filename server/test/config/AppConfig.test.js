import test from "node:test";
import assert from "node:assert/strict";
import { AppConfig } from "../../src/config/AppConfig.js";
import { GroqConstants } from "../../src/constants/GroqConstants.js";

const EXPLICIT_MODEL = "custom-model";
const SYNTHETIC_API_KEY = " synthetic-key ";

test("AppConfig uses the default Groq model when the variable is absent", () => {
  const config = new AppConfig({});

  assert.equal(config.groq.model, GroqConstants.DEFAULT_MODEL);
});

test("AppConfig uses the default Groq model for an empty value", () => {
  const config = new AppConfig({ GROQ_MODEL: "" });

  assert.equal(config.groq.model, GroqConstants.DEFAULT_MODEL);
});

test("AppConfig uses the default Groq model for whitespace only", () => {
  const config = new AppConfig({ GROQ_MODEL: "   " });

  assert.equal(config.groq.model, GroqConstants.DEFAULT_MODEL);
});

test("AppConfig preserves an explicit Groq model", () => {
  const config = new AppConfig({ GROQ_MODEL: EXPLICIT_MODEL });

  assert.equal(config.groq.model, EXPLICIT_MODEL);
});

test("AppConfig trims surrounding whitespace from an explicit Groq model", () => {
  const config = new AppConfig({ GROQ_MODEL: `  ${EXPLICIT_MODEL}  ` });

  assert.equal(config.groq.model, EXPLICIT_MODEL);
});

test("AppConfig does not normalize the Groq API key", () => {
  const config = new AppConfig({
    GROQ_API_KEY: SYNTHETIC_API_KEY,
    GROQ_MODEL: EXPLICIT_MODEL,
  });

  assert.equal(config.groq.apiKey, SYNTHETIC_API_KEY);
});
