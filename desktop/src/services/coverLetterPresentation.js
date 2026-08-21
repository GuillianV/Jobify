const MESSAGE = Object.freeze({
  REFRESH_REQUIRED: "Le contexte de candidature a changé. Relancez l’analyse avant de générer une nouvelle lettre.",
  INSUFFICIENT_CLAIMS: "Votre dossier ne contient pas assez d’éléments vérifiables pour générer une lettre fiable.",
  INPUT_TOO_LARGE: "Les informations nécessaires sont trop volumineuses pour générer la lettre.",
  REQUEST_TOO_LARGE: "La demande est trop volumineuse pour générer la lettre.",
  INVALID_REQUEST: "La demande de génération n’est plus valide. Relancez l’analyse.",
  TEMPORARILY_UNAVAILABLE: "Le service de génération est temporairement indisponible. Réessayez plus tard.",
  TIMEOUT: "La génération a pris trop de temps. Vous pouvez réessayer.",
  RATE_LIMITED: "Le service est momentanément très sollicité. Réessayez plus tard.",
  GENERATION_FAILED: "La lettre n’a pas pu être générée correctement. Vous pouvez réessayer.",
  INVALID_OUTPUT: "La lettre reçue n’est pas exploitable. Vous pouvez réessayer.",
  GENERIC: "Impossible de générer la lettre pour le moment.",
});

const CODE_MESSAGE = Object.freeze({
  APPLICATION_BRIEF_REFRESH_REQUIRED: MESSAGE.REFRESH_REQUIRED,
  INSUFFICIENT_SUPPORTED_CLAIMS: MESSAGE.INSUFFICIENT_CLAIMS,
  COVER_LETTER_INPUT_TOO_LARGE: MESSAGE.INPUT_TOO_LARGE,
  COVER_LETTER_REQUEST_TOO_LARGE: MESSAGE.REQUEST_TOO_LARGE,
  INVALID_COVER_LETTER_REQUEST: MESSAGE.INVALID_REQUEST,
  COVER_LETTER_UNAVAILABLE: MESSAGE.TEMPORARILY_UNAVAILABLE,
  COVER_LETTER_TIMEOUT: MESSAGE.TIMEOUT,
  COVER_LETTER_RATE_LIMITED: MESSAGE.RATE_LIMITED,
  COVER_LETTER_PROVIDER_TOKEN_BUDGET: MESSAGE.GENERATION_FAILED,
  COVER_LETTER_PROVIDER_ERROR: MESSAGE.GENERATION_FAILED,
  INVALID_COVER_LETTER_OUTPUT: MESSAGE.INVALID_OUTPUT,
  INTERNAL_SERVER_ERROR: MESSAGE.GENERIC,
});

/**
 * Resolve one safe localized CoverLetter error without exposing server details.
 * @param {{status: number|null, code: string|null}|null} error - Closed error details.
 * @returns {string} User-facing French message.
 */
function getCoverLetterErrorMessage(error) {
  if (typeof error?.code !== "string") {
    return MESSAGE.GENERIC;
  }
  return CODE_MESSAGE[error.code] ?? MESSAGE.GENERIC;
}

export { getCoverLetterErrorMessage };
