/**
 * Canonical representation of a hiring company attached to an offer.
 */
class Company {
  /**
   * Create a company from its known attributes.
   * @param {object} params - Company attributes.
   * @param {string|null} [params.name] - Company display name.
   * @param {string|null} [params.description] - Short company description.
   * @param {string|null} [params.url] - Public company URL.
   * @param {string|null} [params.logoUrl] - URL of the company logo.
   */
  constructor({ name = null, description = null, url = null, logoUrl = null }) {
    this.name = name;
    this.description = description;
    this.url = url;
    this.logoUrl = logoUrl;
  }

  /**
   * Serialize the company to a plain object.
   * @returns {object} The serialized company.
   */
  toJson() {
    return {
      name: this.name,
      description: this.description,
      url: this.url,
      logoUrl: this.logoUrl,
    };
  }
}

export { Company };
