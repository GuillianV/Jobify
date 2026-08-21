import test from "node:test";
import assert from "node:assert/strict";
import { getCoverLetterErrorMessage } from "../../src/services/coverLetterPresentation.js";

const EXPECTED_MESSAGES = Object.freeze({
  APPLICATION_BRIEF_REFRESH_REQUIRED: "Le contexte de candidature a changé. Relancez l’analyse avant de générer une nouvelle lettre.",
  INSUFFICIENT_SUPPORTED_CLAIMS: "Votre dossier ne contient pas assez d’éléments vérifiables pour générer une lettre fiable.",
  COVER_LETTER_INPUT_TOO_LARGE: "Les informations nécessaires sont trop volumineuses pour générer la lettre.",
  COVER_LETTER_REQUEST_TOO_LARGE: "La demande est trop volumineuse pour générer la lettre.",
  INVALID_COVER_LETTER_REQUEST: "La demande de génération n’est plus valide. Relancez l’analyse.",
  COVER_LETTER_UNAVAILABLE: "Le service de génération est temporairement indisponible. Réessayez plus tard.",
  COVER_LETTER_TIMEOUT: "La génération a pris trop de temps. Vous pouvez réessayer.",
  COVER_LETTER_RATE_LIMITED: "Le service est momentanément très sollicité. Réessayez plus tard.",
  COVER_LETTER_PROVIDER_TOKEN_BUDGET: "La lettre n’a pas pu être générée correctement. Vous pouvez réessayer.",
  COVER_LETTER_PROVIDER_ERROR: "La lettre n’a pas pu être générée correctement. Vous pouvez réessayer.",
  INVALID_COVER_LETTER_OUTPUT: "La lettre reçue n’est pas exploitable. Vous pouvez réessayer.",
  INTERNAL_SERVER_ERROR: "Impossible de générer la lettre pour le moment.",
});

test("presentation maps every public CoverLetter code to fixed French UX", () => {
  for (const [code, message] of Object.entries(EXPECTED_MESSAGES)) {
    assert.equal(getCoverLetterErrorMessage({ status: null, code }), message);
  }
});

test("presentation falls back safely without retaining technical details", () => {
  const generic = "Impossible de générer la lettre pour le moment.";
  assert.equal(getCoverLetterErrorMessage(null), generic);
  assert.equal(getCoverLetterErrorMessage({ status: 500, code: null }), generic);
  assert.equal(getCoverLetterErrorMessage({ status: 418, code: "PRIVATE_CODE" }), generic);
  const serialized = JSON.stringify({
    rendered: getCoverLetterErrorMessage({
      status: 500,
      code: "PRIVATE_CODE",
      message: "server secret",
      generationToken: "token secret",
    }),
  });
  assert.equal(serialized.includes("server secret"), false);
  assert.equal(serialized.includes("token secret"), false);
});
