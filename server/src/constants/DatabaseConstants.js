/**
 * Location constants for the local SQLite database. The database is a single
 * file living next to the server, powered by Node's native node:sqlite module.
 */
class DatabaseConstants {
  static DIRECTORY = "data";

  static FILENAME = "jobify.db";
}

export { DatabaseConstants };
