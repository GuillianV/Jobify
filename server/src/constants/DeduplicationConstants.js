/**
 * Conservative deterministic and semantic deduplication policy constants.
 */
class DeduplicationConstants {
  static MIN_DESCRIPTION_DISTINCT_TOKENS = 50;

  static MAX_MISSING_DESCRIPTION_TOKENS = 1;

  static SEMANTIC_POLICY_VERSION = "SEMANTIC_DEDUP_V2";
}

export { DeduplicationConstants };
