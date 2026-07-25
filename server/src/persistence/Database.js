import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/**
 * Owns the local SQLite connection. Domain-agnostic: each repository applies
 * its own table schema. Uses the native node:sqlite module, so no compiled
 * dependency is required.
 */
class Database {
  /**
   * Open (creating it and its directory if needed) the database file.
   * @param {string} filePath - Absolute path of the SQLite database file.
   */
  constructor(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.connection = new DatabaseSync(filePath);
  }

  /**
   * Return the underlying node:sqlite connection.
   * @returns {import("node:sqlite").DatabaseSync} The database connection.
   */
  getConnection() {
    return this.connection;
  }
}

export { Database };
