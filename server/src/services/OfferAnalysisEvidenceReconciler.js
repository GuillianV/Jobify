import { OfferAnalysisConstants } from "../constants/OfferAnalysisConstants.js";

const COMPARISON_SPACE = " ";
const COMPARISON_APOSTROPHE = "'";
const COMPARISON_QUOTE = "\"";
const COMPARISON_DASH = "-";
const WHITESPACE_CHARACTERS = new Set([" ", "\t", "\n", "\r", "\u00a0"]);
const APOSTROPHE_CHARACTERS = new Set(["'", "\u2018", "\u2019", "\u02bc"]);
const QUOTE_CHARACTERS = new Set(["\"", "\u00ab", "\u00bb", "\u201c", "\u201d"]);
const DASH_CHARACTERS = new Set(["-", "\u2010", "\u2011", "\u2012", "\u2013", "\u2014"]);

/**
 * Reconciles mechanical evidence representations with exact authoritative source slices.
 */
class OfferAnalysisEvidenceReconciler {
  /**
   * Create the reconciler with a grapheme-aware source segmenter.
   */
  constructor() {
    this.segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
  }

  /**
   * Reconcile explicit evidence without mutating the model output.
   * @param {object} analysis - Structurally valid untrusted analysis.
   * @param {string} effectiveText - Exact authoritative source text.
   * @returns {{analysis: object, changed: boolean}} Detached candidate and change marker.
   */
  reconcile(analysis, effectiveText) {
    const reconciled = structuredClone(analysis);
    const normalizedSource = this.normalizeWithSourceMapping(effectiveText);
    let changed = false;
    for (const item of this.collectEvidenceBearingItems(reconciled)) {
      if (item.assertion !== OfferAnalysisConstants.ASSERTION.EXPLICIT
        || typeof item.evidence?.text !== "string"
        || effectiveText.includes(item.evidence.text)) {
        continue;
      }
      const replacement = this.findUniqueExactSourceSlice(
        item.evidence.text,
        effectiveText,
        normalizedSource,
      );
      if (replacement !== null) {
        item.evidence.text = replacement;
        changed = true;
      }
    }
    return { analysis: reconciled, changed };
  }

  /**
   * Collect the six evidence-bearing OfferAnalysis paths.
   * @param {object} analysis - Structurally valid analysis clone.
   * @returns {object[]} Semantic objects that may carry evidence.
   */
  collectEvidenceBearingItems(analysis) {
    const items = [
      ...analysis.activities,
      ...analysis.requirements,
      ...analysis.context,
      ...analysis.workConditions.constraints,
    ];
    if (analysis.seniority !== null) {
      items.push(analysis.seniority);
    }
    if (analysis.workConditions.workMode !== null) {
      items.push(analysis.workConditions.workMode);
    }
    return items;
  }

  /**
   * Find one unambiguous normalized occurrence and return its exact original slice.
   * @param {string} evidenceText - Non-matching model evidence.
   * @param {string} effectiveText - Exact authoritative source.
   * @param {{text: string, mapping: object[]}} normalizedSource - Comparable source.
   * @returns {string|null} Exact source slice, or null when unsafe.
   */
  findUniqueExactSourceSlice(evidenceText, effectiveText, normalizedSource) {
    const normalizedEvidence = this.normalizeForComparison(evidenceText);
    if (!normalizedEvidence) {
      return null;
    }
    const spans = this.findOriginalSpans(normalizedSource, normalizedEvidence);
    if (spans.length !== 1) {
      return null;
    }
    const [span] = spans;
    const candidate = effectiveText.slice(span.start, span.end);
    if (!candidate || !effectiveText.includes(candidate)
      || this.normalizeForComparison(candidate) !== normalizedEvidence) {
      return null;
    }
    return candidate;
  }

  /**
   * Find every distinct original source span matching one normalized evidence value.
   * @param {{text: string, mapping: object[]}} normalizedSource - Comparable source.
   * @param {string} normalizedEvidence - Comparable evidence.
   * @returns {{start: number, end: number}[]} Distinct original spans.
   */
  findOriginalSpans(normalizedSource, normalizedEvidence) {
    const spans = [];
    const identities = new Set();
    let searchFrom = 0;
    while (searchFrom <= normalizedSource.text.length - normalizedEvidence.length) {
      const matchStart = normalizedSource.text.indexOf(normalizedEvidence, searchFrom);
      if (matchStart === -1) {
        break;
      }
      const matchEnd = matchStart + normalizedEvidence.length;
      const start = normalizedSource.mapping[matchStart]?.start;
      const end = normalizedSource.mapping[matchEnd - 1]?.end;
      if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && end > start) {
        const identity = `${start}:${end}`;
        if (!identities.has(identity)) {
          identities.add(identity);
          spans.push({ start, end });
        }
      }
      searchFrom = matchStart + 1;
    }
    return spans;
  }

  /**
   * Normalize text for comparison while preserving source bounds for every output unit.
   * @param {string} value - Source or evidence text.
   * @returns {{text: string, mapping: {start: number, end: number}[]}} Comparable representation.
   */
  normalizeWithSourceMapping(value) {
    let text = "";
    const mapping = [];
    for (const part of this.segmenter.segment(value)) {
      const start = part.index;
      const end = start + part.segment.length;
      const normalized = part.segment.normalize("NFC");
      if (this.isAllowedWhitespaceSegment(normalized)) {
        if (text.endsWith(COMPARISON_SPACE)) {
          mapping[mapping.length - 1].end = end;
        } else {
          text += COMPARISON_SPACE;
          mapping.push({ start, end });
        }
        continue;
      }
      for (const character of normalized) {
        const comparable = this.mapMechanicalCharacter(character);
        text += comparable;
        for (let index = 0; index < comparable.length; index += 1) {
          mapping.push({ start, end });
        }
      }
    }
    return { text, mapping };
  }

  /**
   * Normalize text with the exact same closed comparison rules and discard mapping.
   * @param {string} value - Text to normalize.
   * @returns {string} Comparable text.
   */
  normalizeForComparison(value) {
    return this.normalizeWithSourceMapping(value).text;
  }

  /**
   * Tell whether one complete grapheme contains only allowed whitespace characters.
   * @param {string} segment - NFC grapheme segment.
   * @returns {boolean} True for the closed whitespace allowlist.
   */
  isAllowedWhitespaceSegment(segment) {
    return [...segment].every((character) => {
      return WHITESPACE_CHARACTERS.has(character);
    });
  }

  /**
   * Map one explicitly allowed punctuation variant to its comparison character.
   * @param {string} character - One Unicode code point.
   * @returns {string} Closed mechanical comparison form.
   */
  mapMechanicalCharacter(character) {
    if (APOSTROPHE_CHARACTERS.has(character)) {
      return COMPARISON_APOSTROPHE;
    }
    if (QUOTE_CHARACTERS.has(character)) {
      return COMPARISON_QUOTE;
    }
    if (DASH_CHARACTERS.has(character)) {
      return COMPARISON_DASH;
    }
    return character;
  }
}

export { OfferAnalysisEvidenceReconciler };
