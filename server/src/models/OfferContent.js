import { OfferContentAcquisition } from "../constants/OfferContentAcquisition.js";
import { OfferContentCompleteness } from "../constants/OfferContentCompleteness.js";

const COMPLETENESS_PRIORITY = Object.freeze([
  OfferContentCompleteness.KNOWN_TRUNCATED,
  OfferContentCompleteness.UNKNOWN,
  OfferContentCompleteness.PROVIDER_FULL,
]);
const ACQUISITION_PRIORITY = Object.freeze([
  OfferContentAcquisition.SEARCH,
  OfferContentAcquisition.DETAIL,
]);

/**
 * Persistent offer content with deterministic non-destructive merge rules.
 */
class OfferContent {
  /**
   * Create normalized offer content.
   * @param {object} [params] - Content attributes.
   * @param {object|null} [params.automaticText] - Best automatically acquired text.
   * @param {object|null} [params.userText] - Explicit user-provided text.
   * @param {object|null} [params.structured] - Atomic structured snapshot.
   */
  constructor({ automaticText = null, userText = null, structured = null } = {}) {
    this.automaticText = OfferContent.normalizeAutomaticText(automaticText);
    this.userText = OfferContent.normalizeUserText(userText);
    this.structured = OfferContent.normalizeStructured(structured);
  }

  /**
   * Hydrate trusted content from a persistent payload.
   * @param {object|null|undefined} payload - Persistent content payload.
   * @returns {OfferContent} The normalized content.
   */
  static fromPersistence(payload) {
    return new OfferContent(payload ?? {});
  }

  /**
   * Normalize an automatic text candidate.
   * @param {object|null|undefined} candidate - Candidate to normalize.
   * @returns {object|null} The normalized candidate when useful and valid.
   */
  static normalizeAutomaticText(candidate) {
    if (!OfferContent.hasUsefulText(candidate?.value)) {
      return null;
    }
    if (!OfferContentAcquisition.isValid(candidate.acquisition)) {
      return null;
    }
    if (!OfferContentCompleteness.isValid(candidate.completeness)) {
      return null;
    }
    return {
      value: candidate.value,
      acquisition: candidate.acquisition,
      retrievedAt: OfferContent.normalizeTimestamp(candidate.retrievedAt),
      completeness: candidate.completeness,
    };
  }

  /**
   * Normalize explicit user text without defining conflict semantics.
   * @param {object|null|undefined} candidate - Candidate to normalize.
   * @returns {object|null} The normalized user text when useful.
   */
  static normalizeUserText(candidate) {
    if (!OfferContent.hasUsefulText(candidate?.value)) {
      return null;
    }
    return {
      value: candidate.value,
      providedAt: OfferContent.normalizeTimestamp(candidate.providedAt),
    };
  }

  /**
   * Normalize an atomic structured snapshot.
   * @param {object|null|undefined} candidate - Candidate to normalize.
   * @returns {object|null} The normalized snapshot when present and valid.
   */
  static normalizeStructured(candidate) {
    if (!OfferContent.hasStructuredValue(candidate?.value)) {
      return null;
    }
    if (!OfferContentAcquisition.isValid(candidate.acquisition)) {
      return null;
    }
    return {
      value: OfferContent.cloneStructuredValue(candidate.value),
      acquisition: candidate.acquisition,
      retrievedAt: OfferContent.normalizeTimestamp(candidate.retrievedAt),
    };
  }

  /**
   * Deeply clone one JSON-compatible structured snapshot value.
   * @param {object} value - Structured value to clone.
   * @returns {object} An independent deep clone.
   */
  static cloneStructuredValue(value) {
    return structuredClone(value);
  }

  /**
   * Tell whether a text value contains non-whitespace content.
   * @param {unknown} value - Value to inspect.
   * @returns {boolean} True when the value is useful text.
   */
  static hasUsefulText(value) {
    return typeof value === "string" && Boolean(value.trim());
  }

  /**
   * Tell whether a structured value is a non-empty non-array object.
   * @param {unknown} value - Value to inspect.
   * @returns {boolean} True when the snapshot is present.
   */
  static hasStructuredValue(value) {
    return value !== null
      && typeof value === "object"
      && !Array.isArray(value)
      && Object.keys(value).length > 0;
  }

  /**
   * Normalize an ISO-compatible timestamp and discard invalid values.
   * @param {unknown} value - Timestamp to normalize.
   * @returns {string|null} The original valid timestamp or null.
   */
  static normalizeTimestamp(value) {
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
      return null;
    }
    return value;
  }

  /**
   * Merge automatic and structured acquisitions without mutating either input.
   * @param {OfferContent|object|null|undefined} incoming - Incoming content.
   * @returns {OfferContent} Newly merged content.
   */
  merge(incoming) {
    const normalizedIncoming = incoming instanceof OfferContent
      ? incoming
      : OfferContent.fromPersistence(incoming);
    return new OfferContent({
      automaticText: OfferContent.selectAutomaticText(
        this.automaticText,
        normalizedIncoming.automaticText,
      ),
      userText: this.userText,
      structured: OfferContent.selectStructured(
        this.structured,
        normalizedIncoming.structured,
      ),
    });
  }

  /**
   * Replace explicit user text without mutating or degrading automatic content.
   * @param {string} value - Validated user-provided text stored without rewriting.
   * @param {string} providedAt - Server-generated submission timestamp.
   * @returns {OfferContent} New content carrying the replacement user text.
   */
  withUserText(value, providedAt) {
    return new OfferContent({
      automaticText: this.automaticText,
      userText: { value, providedAt },
      structured: this.structured,
    });
  }

  /**
   * Select the preferred automatic text using completeness, channel and time.
   * @param {object|null} existing - Existing automatic text.
   * @param {object|null} incoming - Incoming automatic text.
   * @returns {object|null} The preferred automatic text.
   */
  static selectAutomaticText(existing, incoming) {
    if (!existing) {
      return incoming;
    }
    if (!incoming) {
      return existing;
    }
    const completenessComparison = OfferContent.comparePriority(
      existing.completeness,
      incoming.completeness,
      COMPLETENESS_PRIORITY,
    );
    if (completenessComparison !== 0) {
      return completenessComparison > 0 ? existing : incoming;
    }
    const acquisitionComparison = OfferContent.comparePriority(
      existing.acquisition,
      incoming.acquisition,
      ACQUISITION_PRIORITY,
    );
    if (acquisitionComparison !== 0) {
      return acquisitionComparison > 0 ? existing : incoming;
    }
    return OfferContent.selectNewest(existing, incoming);
  }

  /**
   * Select the preferred atomic structured snapshot.
   * @param {object|null} existing - Existing snapshot.
   * @param {object|null} incoming - Incoming snapshot.
   * @returns {object|null} The preferred snapshot.
   */
  static selectStructured(existing, incoming) {
    if (!existing) {
      return incoming;
    }
    if (!incoming) {
      return existing;
    }
    const acquisitionComparison = OfferContent.comparePriority(
      existing.acquisition,
      incoming.acquisition,
      ACQUISITION_PRIORITY,
    );
    if (acquisitionComparison !== 0) {
      return acquisitionComparison > 0 ? existing : incoming;
    }
    return OfferContent.selectNewest(existing, incoming);
  }

  /**
   * Compare two values according to an ascending priority list.
   * @param {string} existing - Existing value.
   * @param {string} incoming - Incoming value.
   * @param {string[]} priorities - Ascending priorities.
   * @returns {number} Positive when existing wins, negative when incoming wins.
   */
  static comparePriority(existing, incoming, priorities) {
    return priorities.indexOf(existing) - priorities.indexOf(incoming);
  }

  /**
   * Select the newest candidate while preserving existing on every tie.
   * @param {object} existing - Existing dated candidate.
   * @param {object} incoming - Incoming dated candidate.
   * @returns {object} The selected candidate.
   */
  static selectNewest(existing, incoming) {
    const existingTime = OfferContent.parseTimestamp(existing.retrievedAt);
    const incomingTime = OfferContent.parseTimestamp(incoming.retrievedAt);
    if (existingTime === null) {
      return incomingTime === null ? existing : incoming;
    }
    if (incomingTime === null || incomingTime <= existingTime) {
      return existing;
    }
    return incoming;
  }

  /**
   * Parse a normalized timestamp for comparison.
   * @param {string|null} value - Timestamp to parse.
   * @returns {number|null} Milliseconds since epoch or null.
   */
  static parseTimestamp(value) {
    if (!value) {
      return null;
    }
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : timestamp;
  }

  /**
   * Return the automatic provider text used by the historical description.
   * @returns {string|null} The automatic text or null.
   */
  getAutomaticText() {
    return this.automaticText?.value ?? null;
  }

  /**
   * Return user text when present, otherwise the automatic provider text.
   * @returns {string|null} The effective content text or null.
   */
  getEffectiveText() {
    return this.userText?.value ?? this.getAutomaticText();
  }

  /**
   * Serialize content for the SQLite payload.
   * @returns {object} The persistent content representation.
   */
  toPersistenceJson() {
    return {
      automaticText: this.automaticText ? { ...this.automaticText } : null,
      userText: this.userText ? { ...this.userText } : null,
      structured: this.structured
        ? {
          ...this.structured,
          value: OfferContent.cloneStructuredValue(this.structured.value),
        }
        : null,
    };
  }
}

export { OfferContent };
