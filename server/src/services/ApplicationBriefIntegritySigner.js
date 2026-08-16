import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { CoverLetterLimits } from "../constants/CoverLetterLimits.js";

const HMAC_ALGORITHM = "sha256";
const TOKEN_PREFIX = "v1";
const TOKEN_SEPARATOR = ".";
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

/**
 * Authenticates complete canonical ApplicationBrief values with one process-local secret.
 */
class ApplicationBriefIntegritySigner {
  static SIGNING_DOMAIN = "jobify.application-brief-generation";

  static TOKEN_VERSION = "application-brief-generation-token-v1";

  static SECRET_BYTES = CoverLetterLimits.INTEGRITY_SECRET_BYTES;

  static MAC_BYTES = CoverLetterLimits.HMAC_SHA256_BYTES;

  #secret;

  /**
   * Create one signer owning an independent copy of a sufficiently strong secret.
   * @param {Uint8Array} secret - Server-side signing secret of at least 32 bytes.
   */
  constructor(secret) {
    if (!(secret instanceof Uint8Array)
      || secret.byteLength < ApplicationBriefIntegritySigner.SECRET_BYTES) {
      throw new TypeError("ApplicationBrief integrity secret is invalid");
    }
    this.#secret = Buffer.from(secret);
  }

  /**
   * Create one production signer with a new process-lifetime random secret.
   * @returns {ApplicationBriefIntegritySigner} Ephemeral signer instance.
   */
  static createEphemeral() {
    return new ApplicationBriefIntegritySigner(
      randomBytes(ApplicationBriefIntegritySigner.SECRET_BYTES),
    );
  }

  /**
   * Sign the complete canonical brief under the fixed generation domain.
   * @param {unknown} applicationBriefJson - JSON-compatible complete brief.
   * @returns {string} Opaque versioned integrity token.
   */
  sign(applicationBriefJson) {
    const mac = this.#computeMac(applicationBriefJson);
    return `${TOKEN_PREFIX}${TOKEN_SEPARATOR}${mac.toString("base64url")}`;
  }

  /**
   * Verify one external token without exposing expected authentication material.
   * @param {unknown} applicationBriefJson - JSON-compatible complete brief.
   * @param {unknown} token - External opaque token candidate.
   * @returns {boolean} Whether the token authenticates this exact brief.
   */
  verify(applicationBriefJson, token) {
    const providedMac = this.#parseToken(token);
    if (providedMac === null) {
      return false;
    }
    const expectedMac = this.#computeMac(applicationBriefJson);
    return timingSafeEqual(expectedMac, providedMac);
  }

  /**
   * Compute the HMAC over one unambiguous canonical signing envelope.
   * @param {unknown} applicationBriefJson - Complete brief candidate.
   * @returns {Buffer} Raw SHA-256 MAC.
   */
  #computeMac(applicationBriefJson) {
    const envelope = {
      domain: ApplicationBriefIntegritySigner.SIGNING_DOMAIN,
      tokenVersion: ApplicationBriefIntegritySigner.TOKEN_VERSION,
      brief: applicationBriefJson,
    };
    const serialized = ApplicationBriefIntegritySigner.#canonicalSerialize(envelope);
    return createHmac(HMAC_ALGORITHM, this.#secret)
      .update(Buffer.from(serialized, "utf8"))
      .digest();
  }

  /**
   * Strictly parse one versioned base64url SHA-256 MAC.
   * @param {unknown} token - External token candidate.
   * @returns {Buffer|null} Parsed fixed-length MAC or null.
   */
  #parseToken(token) {
    if (typeof token !== "string") {
      return null;
    }
    const [prefix, encodedMac, ...extra] = token.split(TOKEN_SEPARATOR);
    if (prefix !== TOKEN_PREFIX || !encodedMac || extra.length > 0
      || !BASE64URL_PATTERN.test(encodedMac)) {
      return null;
    }
    const mac = Buffer.from(encodedMac, "base64url");
    return mac.length === ApplicationBriefIntegritySigner.MAC_BYTES
      && mac.toString("base64url") === encodedMac ? mac : null;
  }

  /**
   * Canonically serialize one supported JSON-compatible value.
   * @param {unknown} value - Value to serialize without mutation.
   * @returns {string} Deterministic JSON representation.
   */
  static #canonicalSerialize(value) {
    return JSON.stringify(this.#canonicalize(value, new Set()));
  }

  /**
   * Recursively sort object keys while preserving exact primitives and array order.
   * @param {unknown} value - Canonicalization candidate.
   * @param {Set<object>} ancestors - Active ancestors used to reject cycles.
   * @returns {unknown} Detached canonical value.
   */
  static #canonicalize(value, ancestors) {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value) || Object.is(value, -0)) {
        throw new TypeError("Canonical signing input contains an invalid number");
      }
      return value;
    }
    if (typeof value !== "object") {
      throw new TypeError("Canonical signing input contains an unsupported value");
    }
    if (ancestors.has(value)) {
      throw new TypeError("Canonical signing input contains a cycle");
    }
    ancestors.add(value);
    let canonical;
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length
        || Reflect.ownKeys(value).length !== value.length + 1) {
        throw new TypeError("Canonical signing input requires dense plain arrays");
      }
      canonical = value.map((item) => {
        return this.#canonicalize(item, ancestors);
      });
    } else {
      const prototype = Object.getPrototypeOf(value);
      const keys = Object.keys(value);
      if ((prototype !== Object.prototype && prototype !== null)
        || Reflect.ownKeys(value).length !== keys.length) {
        throw new TypeError("Canonical signing input requires plain enumerable objects");
      }
      canonical = {};
      for (const key of keys.sort()) {
        canonical[key] = this.#canonicalize(value[key], ancestors);
      }
    }
    ancestors.delete(value);
    return canonical;
  }
}

export { ApplicationBriefIntegritySigner };
