const DIACRITICS_PATTERN = /\p{Diacritic}/gu;
const WHITESPACE_PATTERN = /\s+/g;
const DOT_PATTERN = /\./g;
const NON_ALPHANUMERIC_PATTERN = /[^a-z0-9 ]/g;
const EMPTY_STRING = "";
const SINGLE_SPACE = " ";

/**
 * Text normalization helpers shared across connectors. Used to make search and
 * deduplication robust against accents, casing, punctuation and spacing.
 */
class TextNormalizer {
  /**
   * Collapse any run of whitespace into a single space and trim the ends.
   * @param {unknown} value - The value to collapse.
   * @returns {string} The collapsed string, or an empty string when falsy.
   */
  static collapseWhitespace(value) {
    if (!value) {
      return EMPTY_STRING;
    }
    return value
      .toString()
      .replace(WHITESPACE_PATTERN, SINGLE_SPACE)
      .trim();
  }

  /**
   * Lowercase a string, strip accents and collapse whitespace.
   * @param {unknown} value - The value to normalize.
   * @returns {string} The normalized string, or an empty string when falsy.
   */
  static normalize(value) {
    if (!value) {
      return EMPTY_STRING;
    }
    const stripped = value
      .toString()
      .normalize("NFD")
      .replace(DIACRITICS_PATTERN, EMPTY_STRING)
      .toLowerCase();
    return TextNormalizer.collapseWhitespace(stripped);
  }

  /**
   * Normalize keywords for use in a query string. Dots are removed because some
   * providers (Careerjet) return nothing for tokens such as "node.js".
   * @param {unknown} value - The raw keywords.
   * @returns {string} The query-safe keywords.
   */
  static normalizeKeywords(value) {
    if (!value) {
      return EMPTY_STRING;
    }
    return value
      .toString()
      .replace(DOT_PATTERN, SINGLE_SPACE)
      .replace(WHITESPACE_PATTERN, SINGLE_SPACE)
      .trim();
  }

  /**
   * Build a comparison slug: normalized text with punctuation removed. Used as
   * a building block for deduplication keys.
   * @param {unknown} value - The value to slugify.
   * @returns {string} The slug.
   */
  static slug(value) {
    return TextNormalizer.normalize(value)
      .replace(NON_ALPHANUMERIC_PATTERN, EMPTY_STRING)
      .replace(WHITESPACE_PATTERN, SINGLE_SPACE)
      .trim();
  }
}

export { TextNormalizer };
