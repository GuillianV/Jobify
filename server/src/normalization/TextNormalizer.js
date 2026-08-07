const DIACRITICS_PATTERN = /\p{Diacritic}/gu;
const WHITESPACE_PATTERN = /\s+/g;
const DOT_PATTERN = /\./g;
const NON_ALPHANUMERIC_PATTERN = /[^a-z0-9 ]/g;
const HTML_SCRIPT_STYLE_PATTERN = /<(script|style)\b[^<>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const HTML_COMMENT_START_PATTERN = /<!--/g;
const HTML_BREAK_PATTERN = /<br\s*\/?>/gi;
const HTML_LIST_ITEM_START_PATTERN = /<li\b[^<>]*>/gi;
const HTML_LIST_ITEM_END_PATTERN = /<\/li\s*>/gi;
const HTML_BLOCK_PATTERN = /<\/?(?:p|div|h[1-6]|section|article|header|footer|blockquote|pre|ul|ol|table|tr)\b[^<>]*>/gi;
const HTML_TABLE_CELL_PATTERN = /<\/?(?:td|th)\b[^<>]*>/gi;
const HTML_INLINE_TAG_PATTERN = /<\/?(?:a|abbr|b|bdi|bdo|cite|code|del|dfn|em|i|ins|kbd|mark|q|s|samp|small|span|strong|sub|sup|time|u|var|img|picture|source)\b(?:\s[^<>]*?)?\s*\/?>/gi;
const HTML_ENTITY_PATTERN = /&(?:#(\d+)|#x([0-9a-f]+)|([a-z][a-z0-9]+));/gi;
const HTML_CONTENT_PATTERNS = Object.freeze([
  HTML_SCRIPT_STYLE_PATTERN,
  HTML_COMMENT_START_PATTERN,
  HTML_BREAK_PATTERN,
  HTML_LIST_ITEM_START_PATTERN,
  HTML_LIST_ITEM_END_PATTERN,
  HTML_BLOCK_PATTERN,
  HTML_TABLE_CELL_PATTERN,
  HTML_INLINE_TAG_PATTERN,
  HTML_ENTITY_PATTERN,
]);
const NON_BREAKING_SPACE_PATTERN = /\u00a0/g;
const TRAILING_LINE_SPACE_PATTERN = /[ \t]+\n/g;
const LEADING_LINE_SPACE_PATTERN = /\n[ \t]+/g;
const EXCESS_BLANK_LINES_PATTERN = /\n{3,}/g;
const EDGE_LINE_BREAK_PATTERN = /^\n+|\n+$/g;
const EMPTY_STRING = "";
const SINGLE_SPACE = " ";
const LINE_BREAK = "\n";
const PARAGRAPH_BREAK = "\n\n";
const LIST_ITEM_PREFIX = "- ";
const TABLE_CELL_SEPARATOR = "\t";
const DECIMAL_RADIX = 10;
const HEXADECIMAL_RADIX = 16;
const UNICODE_SURROGATE_MIN = 0xD800;
const UNICODE_SURROGATE_MAX = 0xDFFF;
const HTML_ENTITIES = Object.freeze({
  nbsp: "\u00a0",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  euml: "ë",
  agrave: "à",
  acirc: "â",
  auml: "ä",
  icirc: "î",
  iuml: "ï",
  ocirc: "ô",
  ouml: "ö",
  ugrave: "ù",
  ucirc: "û",
  uuml: "ü",
  ccedil: "ç",
  oelig: "œ",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  ndash: "–",
  mdash: "—",
  bull: "•",
  hellip: "…",
  euro: "€",
});

/**
 * Text normalization helpers shared across connectors. Used to make search and
 * deduplication robust against accents, casing, punctuation and spacing.
 */
class TextNormalizer {
  /**
   * Convert external HTML-flavoured content to readable plain text. The result
   * is intended for normal escaped text rendering, never for HTML injection.
   * @param {string|null|undefined} value - The raw external description.
   * @returns {string|null} The plain-text description, or null when absent.
   */
  static htmlToPlainText(value) {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value !== "string") {
      throw new TypeError("HTML text normalization expects a string");
    }
    if (value === EMPTY_STRING || !TextNormalizer.containsHtmlOrEntity(value)) {
      return value;
    }
    const decoded = TextNormalizer.decodeHtmlEntities(value);
    return decoded
      .replace(HTML_SCRIPT_STYLE_PATTERN, EMPTY_STRING)
      .replace(HTML_COMMENT_PATTERN, EMPTY_STRING)
      .replace(HTML_BREAK_PATTERN, LINE_BREAK)
      .replace(HTML_LIST_ITEM_START_PATTERN, LIST_ITEM_PREFIX)
      .replace(HTML_LIST_ITEM_END_PATTERN, LINE_BREAK)
      .replace(HTML_BLOCK_PATTERN, PARAGRAPH_BREAK)
      .replace(HTML_TABLE_CELL_PATTERN, TABLE_CELL_SEPARATOR)
      .replace(HTML_INLINE_TAG_PATTERN, EMPTY_STRING)
      .replace(NON_BREAKING_SPACE_PATTERN, SINGLE_SPACE)
      .replace(TRAILING_LINE_SPACE_PATTERN, LINE_BREAK)
      .replace(LEADING_LINE_SPACE_PATTERN, LINE_BREAK)
      .replace(EXCESS_BLANK_LINES_PATTERN, PARAGRAPH_BREAK)
      .replace(EDGE_LINE_BREAK_PATTERN, EMPTY_STRING);
  }

  /**
   * Tell whether text contains known HTML markup, a comment or an entity.
   * @param {string} value - The text to inspect.
   * @returns {boolean} True when plain-text conversion is necessary.
   */
  static containsHtmlOrEntity(value) {
    for (const pattern of HTML_CONTENT_PATTERNS) {
      pattern.lastIndex = 0;
      const matches = pattern.test(value);
      pattern.lastIndex = 0;
      if (matches) {
        return true;
      }
    }
    return false;
  }

  /**
   * Decode supported named and numeric HTML entities exactly once.
   * @param {string} value - The text containing HTML entities.
   * @returns {string} The text with supported entities decoded.
   */
  static decodeHtmlEntities(value) {
    return value.replace(HTML_ENTITY_PATTERN, (entity, decimal, hexadecimal, named) => {
      if (decimal) {
        return TextNormalizer.decodeNumericEntity(entity, decimal, DECIMAL_RADIX);
      }
      if (hexadecimal) {
        return TextNormalizer.decodeNumericEntity(entity, hexadecimal, HEXADECIMAL_RADIX);
      }
      return HTML_ENTITIES[named.toLowerCase()] ?? entity;
    });
  }

  /**
   * Decode one numeric HTML entity while preserving invalid code points.
   * @param {string} entity - The complete entity to preserve on failure.
   * @param {string} code - The numeric portion of the entity.
   * @param {number} radix - The radix used by the numeric representation.
   * @returns {string} The decoded character, or the original entity when invalid.
   */
  static decodeNumericEntity(entity, code, radix) {
    const codePoint = Number.parseInt(code, radix);
    if (codePoint >= UNICODE_SURROGATE_MIN && codePoint <= UNICODE_SURROGATE_MAX) {
      return entity;
    }
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return entity;
    }
  }

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
