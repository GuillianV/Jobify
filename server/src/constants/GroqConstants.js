/**
 * Constants for the Groq chat completion API used to deduplicate offers
 * semantically (matching the same posting across sources).
 */
class GroqConstants {
  static CHAT_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

  static DEFAULT_MODEL = "llama-3.3-70b-versatile";

  static TEMPERATURE = 0;

  static MAX_TOKENS = 2048;

  static REQUEST_TIMEOUT_MS = 15000;

  static MIN_OFFERS_TO_COMPARE = 2;

  static FIRST_CHOICE_INDEX = 0;

  static DESCRIPTION_SNIPPET_LENGTH = 160;
}

export { GroqConstants };
