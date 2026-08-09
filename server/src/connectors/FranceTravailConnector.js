import { JobConnector } from "./JobConnector.js";
import { JobOffer } from "../models/JobOffer.js";
import { Company } from "../models/Company.js";
import { JobLocation } from "../models/JobLocation.js";
import { Salary } from "../models/Salary.js";
import { JobSource } from "../constants/JobSource.js";
import { HttpStatus } from "../constants/HttpStatus.js";
import { FranceTravailConstants } from "../constants/FranceTravailConstants.js";
import { OfferIdentityKind } from "../constants/OfferIdentityKind.js";
import { ContractTypeNormalizer } from "../normalization/ContractTypeNormalizer.js";
import { DateNormalizer } from "../normalization/DateNormalizer.js";
import { TextNormalizer } from "../normalization/TextNormalizer.js";

const CITY_SEPARATOR = " - ";
const CITY_PART_INDEX = 1;
const COUNTRY_FRANCE = "France";

/**
 * Connector for the France Travail "Offres d'emploi v2" API. It handles the
 * OAuth2 client-credentials flow (with in-memory token caching) and maps the
 * raw offers to the canonical JobOffer model.
 */
class FranceTravailConnector extends JobConnector {
  /**
   * Create the connector from its OAuth2 credentials.
   * @param {object} credentials - France Travail credentials.
   * @param {string} credentials.clientId - OAuth2 client identifier.
   * @param {string} credentials.clientSecret - OAuth2 client secret.
   * @param {string} credentials.scope - OAuth2 scope to request.
   */
  constructor(credentials) {
    super();
    this.clientId = credentials.clientId;
    this.clientSecret = credentials.clientSecret;
    this.scope = credentials.scope;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  /**
   * Return the source identifier produced by this connector.
   * @returns {string} The France Travail source identifier.
   */
  getSource() {
    return JobSource.FRANCE_TRAVAIL;
  }

  /**
   * Tell whether the OAuth2 credentials are present.
   * @returns {boolean} True when both client id and secret are set.
   */
  isConfigured() {
    return Boolean(this.clientId) && Boolean(this.clientSecret);
  }

  /**
   * Return a valid access token, requesting a new one only when the cached
   * token is missing or about to expire.
   * @returns {Promise<string>} A valid bearer token.
   */
  async ensureToken() {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiresAt) {
      return this.accessToken;
    }
    const body = new URLSearchParams();
    body.set("grant_type", "client_credentials");
    body.set("client_id", this.clientId);
    body.set("client_secret", this.clientSecret);
    body.set("scope", this.scope);
    const response = await fetch(FranceTravailConstants.TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`France Travail auth failed (HTTP ${response.status}): ${detail}`);
    }
    const payload = await response.json();
    this.accessToken = payload.access_token;
    const lifetimeSeconds = payload.expires_in - FranceTravailConstants.TOKEN_EXPIRY_BUFFER_SECONDS;
    this.tokenExpiresAt = now + lifetimeSeconds * FranceTravailConstants.MILLISECONDS_PER_SECOND;
    return this.accessToken;
  }

  /**
   * Search offers matching the given criteria and map them to JobOffer.
   * @param {import("../models/SearchCriteria.js").SearchCriteria} criteria - Criteria.
   * @returns {Promise<JobOffer[]>} The canonical offers.
   */
  async search(criteria) {
    const token = await this.ensureToken();
    const url = new URL(FranceTravailConstants.SEARCH_ENDPOINT);
    url.searchParams.set("motsCles", criteria.keywords);
    if (criteria.communeInsee) {
      url.searchParams.set("commune", criteria.communeInsee);
      url.searchParams.set("distance", String(criteria.distanceKm));
    }
    url.searchParams.set("range", FranceTravailConstants.DEFAULT_RANGE);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === HttpStatus.NO_CONTENT) {
      return [];
    }
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`France Travail search failed (HTTP ${response.status}): ${detail}`);
    }
    const payload = await response.json();
    const results = payload.resultats ?? [];
    return results.map((raw) => {
      return this.mapOffer(raw);
    });
  }

  /**
   * Map a single raw France Travail offer to the canonical JobOffer model.
   * @param {object} raw - The raw offer object from the API.
   * @returns {JobOffer} The canonical offer.
   */
  mapOffer(raw) {
    const place = raw.lieuTravail ?? {};
    const employer = raw.entreprise ?? {};
    const origin = raw.origineOffre ?? {};
    const pay = raw.salaire ?? {};
    const description = TextNormalizer.htmlToPlainText(raw.description);
    const labelParts = (place.libelle ?? "").split(CITY_SEPARATOR);
    const city = labelParts.length > CITY_PART_INDEX ? labelParts[CITY_PART_INDEX].trim() : null;
    return new JobOffer({
      source: JobSource.FRANCE_TRAVAIL,
      sourceId: raw.id,
      identityKind: OfferIdentityKind.STABLE,
      title: raw.intitule,
      description,
      company: new Company({
        name: employer.nom ?? null,
        description: employer.description ?? null,
        url: employer.url ?? null,
        logoUrl: employer.logo ?? null,
      }),
      location: new JobLocation({
        label: place.libelle ?? null,
        city,
        postalCode: place.codePostal ?? null,
        latitude: place.latitude ?? null,
        longitude: place.longitude ?? null,
        country: COUNTRY_FRANCE,
      }),
      contractType: ContractTypeNormalizer.fromFranceTravail(raw.typeContrat, Boolean(raw.alternance)),
      contractTypeLabel: raw.typeContratLibelle ?? raw.typeContrat ?? null,
      salary: Salary.fromLabel(pay.libelle ?? null),
      applyUrl: origin.urlOrigine ?? null,
      publishedAt: DateNormalizer.toIso(raw.dateCreation),
    });
  }
}

export { FranceTravailConnector };
