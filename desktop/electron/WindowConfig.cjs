/**
 * Configuration constants for the main application window.
 */
class WindowConfig {
  static WIDTH = 1100;

  static HEIGHT = 800;

  static TITLE = "Jobify";

  static PRELOAD_FILE = "preload.cjs";

  static DEV_SERVER_URL = "http://localhost:5173";

  static PRODUCTION_ENTRY = "../dist/index.html";
}

module.exports = { WindowConfig };
