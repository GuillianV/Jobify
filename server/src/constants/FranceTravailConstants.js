/**
 * Endpoints and tuning constants for the France Travail connector.
 */
class FranceTravailConstants {
  static TOKEN_ENDPOINT =
    "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire";

  static SEARCH_ENDPOINT =
    "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";

  static DEFAULT_SCOPE = "api_offresdemploiv2 o2dsoffre";

  static DEFAULT_RANGE = "0-99";

  static TOKEN_EXPIRY_BUFFER_SECONDS = 60;

  static MILLISECONDS_PER_SECOND = 1000;
}

export { FranceTravailConstants };
