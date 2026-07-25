/**
 * Canonical representation of a job location.
 */
class JobLocation {
  /**
   * Create a location from its known attributes.
   * @param {object} params - Location attributes.
   * @param {string|null} [params.label] - Human readable location label.
   * @param {string|null} [params.city] - City name.
   * @param {string|null} [params.postalCode] - Postal code.
   * @param {number|null} [params.latitude] - Latitude in decimal degrees.
   * @param {number|null} [params.longitude] - Longitude in decimal degrees.
   * @param {string|null} [params.country] - Country name.
   */
  constructor({
    label = null,
    city = null,
    postalCode = null,
    latitude = null,
    longitude = null,
    country = null,
  }) {
    this.label = label;
    this.city = city;
    this.postalCode = postalCode;
    this.latitude = latitude;
    this.longitude = longitude;
    this.country = country;
  }

  /**
   * Serialize the location to a plain object.
   * @returns {object} The serialized location.
   */
  toJson() {
    return {
      label: this.label,
      city: this.city,
      postalCode: this.postalCode,
      latitude: this.latitude,
      longitude: this.longitude,
      country: this.country,
    };
  }
}

export { JobLocation };
