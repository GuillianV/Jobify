/**
 * Endpoint and request constants for the Careerjet connector.
 * The public Careerjet API is served over plain HTTP and requires a Referer
 * header plus user_ip / user_agent parameters.
 */
class CareerjetConstants {
  static SEARCH_ENDPOINT = "http://public.api.careerjet.net/search";

  static LOCALE_CODE = "fr_FR";

  static PAGE_SIZE = 50;

  static RICH_DESCRIPTION_FRAGMENT_SIZE = 10000;

  static REFERER = "https://jobify.app/";

  static USER_AGENT = "Mozilla/5.0";

  static USER_IP = "8.8.8.8";

  static ERROR_TYPE = "ERROR";
}

export { CareerjetConstants };
