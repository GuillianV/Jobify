import { SearchProfile } from "../models/SearchProfile.js";

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    keywords TEXT NOT NULL,
    city TEXT,
    distance_km INTEGER,
    created_at TEXT NOT NULL
  );
`;

const INSERT_SQL = `
  INSERT INTO profiles (label, keywords, city, distance_km, created_at)
  VALUES (?, ?, ?, ?, ?)
`;

const SELECT_ALL_SQL = "SELECT * FROM profiles ORDER BY created_at DESC";

const DELETE_SQL = "DELETE FROM profiles WHERE id = ?";

/**
 * Persists the saved search profiles that drive scheduled searches.
 */
class ProfileRepository {
  /**
   * Prepare the statements used by the repository.
   * @param {import("./Database.js").Database} database - The database wrapper.
   */
  constructor(database) {
    this.connection = database.getConnection();
    this.connection.exec(SCHEMA_SQL);
    this.insertStatement = this.connection.prepare(INSERT_SQL);
    this.selectAllStatement = this.connection.prepare(SELECT_ALL_SQL);
    this.deleteStatement = this.connection.prepare(DELETE_SQL);
  }

  /**
   * Insert a new profile and return it with its assigned identifier.
   * @param {SearchProfile} profile - The profile to store.
   * @returns {SearchProfile} The stored profile, with id and createdAt set.
   */
  create(profile) {
    const createdAt = new Date().toISOString();
    const result = this.insertStatement.run(
      profile.label,
      profile.keywords,
      profile.city ?? null,
      profile.distanceKm,
      createdAt,
    );
    return new SearchProfile({
      id: Number(result.lastInsertRowid),
      label: profile.label,
      keywords: profile.keywords,
      city: profile.city,
      distanceKm: profile.distanceKm,
      createdAt,
    });
  }

  /**
   * Return every saved profile, newest first.
   * @returns {SearchProfile[]} The stored profiles.
   */
  list() {
    return this.selectAllStatement.all().map((row) => {
      return this.rowToProfile(row);
    });
  }

  /**
   * Delete a profile by its identifier.
   * @param {number} id - The profile identifier.
   * @returns {boolean} True when a profile was deleted.
   */
  remove(id) {
    const result = this.deleteStatement.run(id);
    return result.changes > 0;
  }

  /**
   * Map a database row to a SearchProfile.
   * @param {object} row - The raw database row.
   * @returns {SearchProfile} The reconstructed profile.
   */
  rowToProfile(row) {
    return new SearchProfile({
      id: row.id,
      label: row.label,
      keywords: row.keywords,
      city: row.city,
      distanceKm: row.distance_km,
      createdAt: row.created_at,
    });
  }
}

export { ProfileRepository };
