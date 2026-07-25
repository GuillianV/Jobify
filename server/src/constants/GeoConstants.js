/**
 * Endpoint and tuning constants for the French administrative geo API
 * (geo.api.gouv.fr), used to resolve a city name into an INSEE commune code.
 */
class GeoConstants {
  static COMMUNES_ENDPOINT = "https://geo.api.gouv.fr/communes";

  static RESULT_LIMIT = 1;
}

export { GeoConstants };
