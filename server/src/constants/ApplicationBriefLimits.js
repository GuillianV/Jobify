/**
 * Cardinality and text limits for ApplicationBrief V1.
 */
class ApplicationBriefLimits {
  static MAX_REQUIREMENT_MATCHES = 20;

  static MAX_EMPHASIS = 12;

  static MAX_SUPPORTED_CLAIMS = 20;

  static MAX_CAUTIONS = 20;

  static MAX_EVIDENCE_FACTS = 256;

  static MAX_REFS_PER_ITEM = 8;

  static MAX_FACETS_PER_REQUIREMENT_MATCH = 8;

  static MAX_EVIDENCE_REFS_PER_ITEM = 8;

  static MAX_RELEVANCE_REASON_LENGTH = 240;

  static MAX_ANALYZER_POLICY_VERSION_LENGTH = 64;

  static SHA256_HEX_LENGTH = 64;
}

export { ApplicationBriefLimits };
