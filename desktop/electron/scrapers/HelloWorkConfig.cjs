/**
 * Endpoints, session and parsing constants for the client-side HelloWork
 * scraper. HelloWork is scraped in the Electron renderer process (client side),
 * with a persistent session partition so the user's own browsing session is
 * reused and never leaves the machine.
 */
class HelloWorkConfig {
  static SOURCE = "hellowork";

  static BASE_URL = "https://www.hellowork.com";

  static ALLOWED_ORIGIN = "https://www.hellowork.com";

  static ALLOWED_PROTOCOL = "https:";

  static SEARCH_PATH = "/fr-fr/emploi/recherche.html";

  static KEYWORDS_PARAM = "k";

  static LOCATION_PARAM = "l";

  static SESSION_PARTITION = "persist:jobify-scraping";

  static USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    + "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  static WINDOW_WIDTH = 1280;

  static WINDOW_HEIGHT = 800;

  static LOAD_TIMEOUT_MS = 20000;

  static COUNTRY = "France";

  static DEFAULT_CONTRACT_TYPE = "OTHER";

  static LOCATION_PREFIX = " à ";

  static COMPANY_DELIMITER = ", chez ";

  static CONTRACT_PATTERN = /pour une? ([^,]+),/;

  static RELATIVE_DATE_PATTERN = /il y a\s+(\d+)\s+(minute|heure|jour|semaine|mois)/i;

  static CITY_DEPARTMENT_SEPARATOR = " - ";

  static CONTRACT_TYPE_MAP = {
    cdi: "CDI",
    cdd: "CDD",
    interim: "INTERIM",
    alternance: "ALTERNANCE",
    stage: "STAGE",
    freelance: "FREELANCE",
    independant: "FREELANCE",
  };

  static RELATIVE_UNIT_MS = {
    minute: 60000,
    heure: 3600000,
    jour: 86400000,
    semaine: 604800000,
    mois: 2592000000,
  };

  static DEFAULT_SALARY_PERIOD = "UNKNOWN";

  static HEX_RADIX = 16;

  static SALARY_UNIT_MAP = {
    YEAR: "YEARLY",
    MONTH: "MONTHLY",
    HOUR: "HOURLY",
  };

  static HTML_BREAK_PATTERN = /<br\s*\/?>|<\/(p|li|div|h[1-6]|tr)>/gi;

  static HTML_TAG_PATTERN = /<[^>]+>/g;

  static EXCESS_BLANK_LINES_PATTERN = /\n{3,}/g;
}

module.exports = { HelloWorkConfig };
