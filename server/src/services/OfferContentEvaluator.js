import { OfferContentEvaluationConstants } from "../constants/OfferContentEvaluationConstants.js";
import { OfferContent } from "../models/OfferContent.js";

const WORD_PATTERN = /[\p{L}\p{N}]+/gu;
const WHITESPACE_PATTERN = /\s+/gu;
const APOSTROPHE_PATTERN = /[\u2018\u2019]/gu;
const TERMINAL_PUNCTUATION_PATTERN = /[.!?;:,]+$/u;

/**
 * Pure deterministic evaluation of the effective text held by OfferContent.
 */
class OfferContentEvaluator {
  /**
   * Evaluate whether effective offer text contains enough material for analysis.
   * @param {OfferContent} offerContent - Content whose effective text must be evaluated.
   * @returns {object} Sufficiency status, diagnostic reasons, metrics and policy version.
   */
  evaluate(offerContent) {
    if (!(offerContent instanceof OfferContent)) {
      throw new TypeError("OfferContentEvaluator requires an OfferContent");
    }
    const effective = this.resolveEffectiveText(offerContent);
    if (effective.text === null) {
      return this.buildMissingEvaluation();
    }
    const normalizedText = this.normalizeText(effective.text);
    const tokens = this.tokenize(normalizedText);
    const metrics = this.buildMetrics(normalizedText, tokens, effective);
    const reasons = this.buildInsufficientReasons(normalizedText, metrics);
    if (reasons.length > 0) {
      return this.buildEvaluation(
        OfferContentEvaluationConstants.STATUS.INSUFFICIENT,
        reasons,
        metrics,
      );
    }
    if (this.hasSufficientVolume(metrics)) {
      return this.buildEvaluation(
        OfferContentEvaluationConstants.STATUS.SUFFICIENT,
        [OfferContentEvaluationConstants.REASON.SUFFICIENT_TEXT_VOLUME],
        metrics,
      );
    }
    return this.buildEvaluation(
      OfferContentEvaluationConstants.STATUS.UNDETERMINED,
      [OfferContentEvaluationConstants.REASON.INTERMEDIATE_CONTENT],
      metrics,
    );
  }

  /**
   * Resolve effective text and metadata without changing the supplied content.
   * @param {OfferContent} offerContent - Normalized offer content.
   * @returns {object} Effective text with its source metadata.
   */
  resolveEffectiveText(offerContent) {
    if (offerContent.userText) {
      return {
        text: offerContent.getEffectiveText(),
        textSource: OfferContentEvaluationConstants.TEXT_SOURCE.USER,
        acquisition: null,
        completeness: null,
      };
    }
    if (offerContent.automaticText) {
      return {
        text: offerContent.getEffectiveText(),
        textSource: OfferContentEvaluationConstants.TEXT_SOURCE.AUTOMATIC,
        acquisition: offerContent.automaticText.acquisition,
        completeness: offerContent.automaticText.completeness,
      };
    }
    return {
      text: null,
      textSource: OfferContentEvaluationConstants.TEXT_SOURCE.NONE,
      acquisition: null,
      completeness: null,
    };
  }

  /**
   * Normalize text exclusively for deterministic analysis.
   * @param {string} text - Effective stored text.
   * @returns {string} NFC text with trimmed and collapsed whitespace.
   */
  normalizeText(text) {
    return text.normalize("NFC").trim().replace(WHITESPACE_PATTERN, " ");
  }

  /**
   * Split normalized text into lowercase Unicode letter-or-number tokens.
   * @param {string} normalizedText - Text prepared for analysis.
   * @returns {string[]} Normalized word tokens.
   */
  tokenize(normalizedText) {
    const matches = normalizedText.match(WORD_PATTERN) ?? [];
    return matches.map((token) => {
      return token.toLocaleLowerCase("fr-FR");
    });
  }

  /**
   * Build every public metric for present effective text.
   * @param {string} normalizedText - Text prepared for analysis.
   * @param {string[]} tokens - Normalized word tokens.
   * @param {object} effective - Effective source metadata.
   * @returns {object} Complete public metrics.
   */
  buildMetrics(normalizedText, tokens, effective) {
    return {
      characterCount: Array.from(normalizedText).length,
      wordCount: tokens.length,
      distinctWordCount: new Set(tokens).size,
      repeatedFiveGramShare: this.calculateRepeatedFiveGramShare(tokens),
      textSource: effective.textSource,
      acquisition: effective.acquisition,
      completeness: effective.completeness,
    };
  }

  /**
   * Calculate the share of five-gram positions whose sequence occurs repeatedly.
   * @param {string[]} tokens - Normalized word tokens.
   * @returns {number} Finite deterministic ratio between zero and one.
   */
  calculateRepeatedFiveGramShare(tokens) {
    const gramSize = OfferContentEvaluationConstants.FIVE_GRAM_SIZE;
    if (tokens.length < gramSize) {
      return 0;
    }
    const gramCount = tokens.length - gramSize + 1;
    const grams = [];
    const occurrences = new Map();
    for (let index = 0; index < gramCount; index += 1) {
      const gram = tokens.slice(index, index + gramSize).join(" ");
      grams.push(gram);
      occurrences.set(gram, (occurrences.get(gram) ?? 0) + 1);
    }
    const repeatedCount = grams.reduce((count, gram) => {
      if (occurrences.get(gram) > 1) {
        return count + 1;
      }
      return count;
    }, 0);
    return repeatedCount / gramCount;
  }

  /**
   * Build ordered reasons for every manifestly insufficient condition.
   * @param {string} normalizedText - Text prepared for analysis.
   * @param {object} metrics - Complete public metrics.
   * @returns {string[]} Applicable reasons in stable contract order.
   */
  buildInsufficientReasons(normalizedText, metrics) {
    const reasons = [];
    if (this.isBelowLowThreshold(metrics)) {
      reasons.push(OfferContentEvaluationConstants.REASON.TOO_SHORT);
    }
    if (this.isPlaceholder(normalizedText)) {
      reasons.push(OfferContentEvaluationConstants.REASON.PLACEHOLDER_CONTENT);
    }
    if (metrics.repeatedFiveGramShare
      >= OfferContentEvaluationConstants.HIGH_REPETITION_SHARE) {
      reasons.push(OfferContentEvaluationConstants.REASON.HIGHLY_REPETITIVE);
    }
    return reasons;
  }

  /**
   * Tell whether any calibrated lower bound is missed.
   * @param {object} metrics - Complete public metrics.
   * @returns {boolean} True when text is manifestly too short.
   */
  isBelowLowThreshold(metrics) {
    return metrics.characterCount < OfferContentEvaluationConstants.LOW_CHARACTER_COUNT
      || metrics.wordCount < OfferContentEvaluationConstants.LOW_WORD_COUNT
      || metrics.distinctWordCount
        < OfferContentEvaluationConstants.LOW_DISTINCT_WORD_COUNT;
  }

  /**
   * Tell whether every calibrated upper bound is reached.
   * @param {object} metrics - Complete public metrics.
   * @returns {boolean} True when text has clearly sufficient volume.
   */
  hasSufficientVolume(metrics) {
    return metrics.characterCount >= OfferContentEvaluationConstants.HIGH_CHARACTER_COUNT
      && metrics.wordCount >= OfferContentEvaluationConstants.HIGH_WORD_COUNT
      && metrics.distinctWordCount
        >= OfferContentEvaluationConstants.HIGH_DISTINCT_WORD_COUNT;
  }

  /**
   * Match only the complete narrow V1 placeholder vocabulary.
   * @param {string} normalizedText - Text prepared for analysis.
   * @returns {boolean} True when the whole text is a supported placeholder.
   */
  isPlaceholder(normalizedText) {
    const canonical = normalizedText
      .toLocaleLowerCase("fr-FR")
      .replace(APOSTROPHE_PATTERN, "'")
      .replace(TERMINAL_PUNCTUATION_PATTERN, "")
      .trim();
    return OfferContentEvaluationConstants.PLACEHOLDERS.includes(canonical);
  }

  /**
   * Build the fixed missing-text result.
   * @returns {object} Insufficient evaluation with zero-valued metrics.
   */
  buildMissingEvaluation() {
    return this.buildEvaluation(
      OfferContentEvaluationConstants.STATUS.INSUFFICIENT,
      [OfferContentEvaluationConstants.REASON.MISSING_TEXT],
      {
        characterCount: 0,
        wordCount: 0,
        distinctWordCount: 0,
        repeatedFiveGramShare: 0,
        textSource: OfferContentEvaluationConstants.TEXT_SOURCE.NONE,
        acquisition: null,
        completeness: null,
      },
    );
  }

  /**
   * Build a fresh result conforming to the versioned public contract.
   * @param {string} status - Evaluation status.
   * @param {string[]} reasons - Ordered diagnostic reasons.
   * @param {object} metrics - Complete public metrics.
   * @returns {object} Fresh evaluation result.
   */
  buildEvaluation(status, reasons, metrics) {
    return {
      status,
      reasons: [...reasons],
      metrics: { ...metrics },
      policyVersion: OfferContentEvaluationConstants.POLICY_VERSION,
    };
  }
}

export { OfferContentEvaluator };
