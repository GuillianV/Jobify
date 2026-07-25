import { SalaryPeriod } from "../constants/SalaryPeriod.js";
import { TextNormalizer } from "../normalization/TextNormalizer.js";

const NUMBER_PATTERN = /\d[\d\s]*/g;
const WHITESPACE_PATTERN = /\s/g;
const YEAR_WORD_PATTERN = /\ban\b/;
const FIRST_NUMBER_INDEX = 0;
const SECOND_NUMBER_INDEX = 1;
const CURRENCY_EURO = "EUR";
const EURO_SIGN = "€";

/**
 * Canonical representation of the compensation attached to an offer.
 */
class Salary {
  /**
   * Create a salary from its known attributes.
   * @param {object} params - Salary attributes.
   * @param {number|null} [params.min] - Minimum amount for the period.
   * @param {number|null} [params.max] - Maximum amount for the period.
   * @param {string|null} [params.currency] - ISO currency code.
   * @param {string} [params.period] - Salary period (see SalaryPeriod).
   * @param {string|null} [params.raw] - Original free-text salary label.
   */
  constructor({
    min = null,
    max = null,
    currency = null,
    period = SalaryPeriod.UNKNOWN,
    raw = null,
  }) {
    this.min = min;
    this.max = max;
    this.currency = currency;
    this.period = period;
    this.raw = raw;
  }

  /**
   * Build a salary from explicit amounts (used by sources exposing numbers).
   * @param {number|null} min - Minimum amount.
   * @param {number|null} max - Maximum amount.
   * @param {string|null} currency - ISO currency code.
   * @param {string} period - Salary period (see SalaryPeriod).
   * @returns {Salary} The salary.
   */
  static fromAmounts(min, max, currency, period) {
    return new Salary({ min, max, currency, period, raw: null });
  }

  /**
   * Detect the salary period from a normalized label.
   * @param {string} normalized - The accent-stripped, lowercased label.
   * @returns {string} The detected period (see SalaryPeriod).
   */
  static detectPeriod(normalized) {
    if (normalized.includes("annuel") || normalized.includes("year") || YEAR_WORD_PATTERN.test(normalized)) {
      return SalaryPeriod.YEARLY;
    }
    if (normalized.includes("mensuel") || normalized.includes("mois") || normalized.includes("month")) {
      return SalaryPeriod.MONTHLY;
    }
    if (normalized.includes("heure") || normalized.includes("hour")) {
      return SalaryPeriod.HOURLY;
    }
    return SalaryPeriod.UNKNOWN;
  }

  /**
   * Build a Salary from a free-text label on a best-effort basis: the first two
   * numbers become the min and max, and the currency and period are inferred.
   * @param {string|null|undefined} label - Free-text salary label.
   * @returns {Salary} The parsed salary, keeping the raw label.
   */
  static fromLabel(label) {
    if (!label) {
      return new Salary({});
    }
    const normalized = TextNormalizer.normalize(label);
    const matches = label.match(NUMBER_PATTERN) ?? [];
    const numbers = matches.map((token) => {
      return Number(token.replace(WHITESPACE_PATTERN, ""));
    });
    const min = numbers.length > FIRST_NUMBER_INDEX ? numbers[FIRST_NUMBER_INDEX] : null;
    const max = numbers.length > SECOND_NUMBER_INDEX ? numbers[SECOND_NUMBER_INDEX] : null;
    const currency = label.includes(EURO_SIGN) || normalized.includes("euro") ? CURRENCY_EURO : null;
    return new Salary({ min, max, currency, period: Salary.detectPeriod(normalized), raw: label });
  }

  /**
   * Serialize the salary to a plain object.
   * @returns {object} The serialized salary.
   */
  toJson() {
    return {
      min: this.min,
      max: this.max,
      currency: this.currency,
      period: this.period,
      raw: this.raw,
    };
  }
}

export { Salary };
