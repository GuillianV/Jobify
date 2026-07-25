/**
 * Normalizes the heterogeneous publication dates returned by the sources
 * (ISO 8601, RFC 2822, ...) into a single ISO 8601 string.
 */
class DateNormalizer {
  /**
   * Convert any parseable date value to an ISO 8601 string.
   * @param {string|number|Date|null|undefined} value - The raw date value.
   * @returns {string|null} The ISO string, or null when unparseable.
   */
  static toIso(value) {
    if (!value) {
      return null;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString();
  }
}

export { DateNormalizer };
