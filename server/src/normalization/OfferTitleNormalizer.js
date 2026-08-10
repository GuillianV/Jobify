import { TextNormalizer } from "./TextNormalizer.js";

const GENDER_MARKERS = new Set(["hf", "fh"]);
const NON_ALPHANUMERIC_PATTERN = /[^a-z0-9]+/gu;

/**
 * Builds conservative canonical job titles for deterministic comparison.
 */
class OfferTitleNormalizer {
  /**
   * Normalize one title and remove gender markers and an exact company suffix.
   * @param {unknown} title - Raw offer title.
   * @param {unknown} company - Raw company name.
   * @returns {string} Canonical title.
   */
  canonicalize(title, company) {
    const titleTokens = this.tokenize(title);
    const companyTokens = this.tokenize(company);
    const withoutCompany = this.removeCompanySuffix(titleTokens, companyTokens);
    return this.removeGenderMarkers(withoutCompany).join(" ");
  }

  /**
   * Convert normalized text into alphanumeric comparison tokens.
   * @param {unknown} value - Raw text.
   * @returns {string[]} Comparison tokens.
   */
  tokenize(value) {
    const normalized = TextNormalizer.normalize(value)
      .replace(NON_ALPHANUMERIC_PATTERN, " ")
      .trim();
    return normalized ? normalized.split(" ") : [];
  }

  /**
   * Remove an exact complete company-token suffix.
   * @param {string[]} titleTokens - Normalized title tokens.
   * @param {string[]} companyTokens - Normalized company tokens.
   * @returns {string[]} Title without its provider-added company suffix.
   */
  removeCompanySuffix(titleTokens, companyTokens) {
    if (companyTokens.length === 0 || companyTokens.length > titleTokens.length) {
      return [...titleTokens];
    }
    const offset = titleTokens.length - companyTokens.length;
    const matches = companyTokens.every((token, index) => {
      return titleTokens[offset + index] === token;
    });
    return matches ? titleTokens.slice(0, offset) : [...titleTokens];
  }

  /**
   * Remove compact and split gender markers at token boundaries.
   * @param {string[]} tokens - Normalized title tokens.
   * @returns {string[]} Tokens without gender markers.
   */
  removeGenderMarkers(tokens) {
    const result = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      const next = tokens[index + 1];
      if (GENDER_MARKERS.has(token)) {
        continue;
      }
      if ((token === "h" && next === "f") || (token === "f" && next === "h")) {
        index += 1;
        continue;
      }
      result.push(token);
    }
    return result;
  }
}

export { OfferTitleNormalizer };
