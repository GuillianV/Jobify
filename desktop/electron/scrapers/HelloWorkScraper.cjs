const { BrowserWindow } = require("electron");
const { HelloWorkConfig } = require("./HelloWorkConfig.cjs");

const DIACRITICS_PATTERN = /\p{Diacritic}/gu;
const EMPTY_STRING = "";
const FIRST_MATCH_GROUP = 1;
const SECOND_MATCH_GROUP = 2;
const FIRST_PART_INDEX = 0;

/**
 * In-page script executed inside the loaded HelloWork result page. It reads the
 * server-rendered offer cards from the DOM and returns a serializable array of
 * raw fields. Running in the page context reuses the user's own session and
 * needs no HTML parsing dependency.
 */
const EXTRACTION_SCRIPT = `
  (function () {
    var cards = document.querySelectorAll('li[data-hide-offer-item-id-value]');
    return Array.prototype.map.call(cards, function (card) {
      var titleInput = card.querySelector('input[name="title"]');
      var companyInput = card.querySelector('input[name="company"]');
      var link = card.querySelector('a[data-cy="offerTitle"]');
      return {
        id: card.getAttribute('data-hide-offer-item-id-value'),
        title: titleInput ? titleInput.value : (link ? link.textContent.trim() : null),
        company: companyInput ? companyInput.value : null,
        href: link ? link.getAttribute('href') : null,
        ariaLabel: link ? link.getAttribute('aria-label') : '',
        cardText: card.innerText || ''
      };
    });
  })();
`;

/**
 * In-page script executed on a HelloWork offer detail page. It returns the raw
 * JSON-LD JobPosting block, which carries the full description, the exact
 * publication timestamp and the structured salary.
 */
const JOB_POSTING_SCRIPT = `
  (function () {
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      try {
        var parsed = JSON.parse(scripts[i].textContent);
        if (parsed && parsed['@type'] === 'JobPosting') {
          return scripts[i].textContent;
        }
      } catch (error) {
        continue;
      }
    }
    return null;
  })();
`;

/**
 * Client-side scraper for HelloWork. It loads a HelloWork search page in a
 * hidden Electron window (using a persistent session partition so cookies stay
 * on the user's machine), extracts the offer cards from the DOM and maps them
 * to the canonical offer shape shared with the API connectors.
 */
class HelloWorkScraper {
  /**
   * Search HelloWork and return the normalized offers. Any failure is the
   * caller's to handle; the hidden window is always destroyed.
   * @param {string} keywords - The searched keywords.
   * @param {string|null} location - The searched location (city name).
   * @returns {Promise<object[]>} The canonical offers scraped from HelloWork.
   */
  async search(keywords, location) {
    const url = this.buildSearchUrl(keywords, location);
    const rawOffers = await this.runInWindow(url, EXTRACTION_SCRIPT);
    return rawOffers.map((raw) => {
      return this.normalizeOffer(raw);
    });
  }

  /**
   * Load a URL in a hidden window, run an extraction script in its page context
   * and always destroy the window, returning the script result.
   * @param {string} url - The URL to load.
   * @param {string} script - The in-page extraction script.
   * @returns {Promise<*>} The value returned by the extraction script.
   */
  async runInWindow(url, script) {
    const scrapingWindow = this.createWindow();
    try {
      await this.loadWithTimeout(scrapingWindow, url);
      return await scrapingWindow.webContents.executeJavaScript(script, true);
    } finally {
      scrapingWindow.destroy();
    }
  }

  /**
   * Load an offer detail page and extract its richer fields (full description,
   * exact publication date and structured salary) from the JSON-LD JobPosting.
   * @param {string} url - The offer detail URL.
   * @returns {Promise<object|null>} The enriched fields, or null when absent.
   */
  async fetchDetail(url) {
    const rawJson = await this.runInWindow(url, JOB_POSTING_SCRIPT);
    if (!rawJson) {
      return null;
    }
    return this.normalizeDetail(rawJson);
  }

  /**
   * Map a raw JSON-LD JobPosting string to the enriched detail fields.
   * @param {string} rawJson - The JSON-LD JobPosting block.
   * @returns {object} The enriched fields.
   */
  normalizeDetail(rawJson) {
    const posting = JSON.parse(rawJson);
    return {
      description: this.cleanDescription(posting.description),
      publishedAt: this.toIsoDate(posting.datePosted),
      salary: this.parseDetailSalary(posting.baseSalary),
    };
  }

  /**
   * Turn an HTML description into readable plain text: block tags become line
   * breaks, remaining tags are stripped and entities are decoded.
   * @param {string|null} description - The raw HTML description.
   * @returns {string|null} The plain-text description, or null when absent.
   */
  cleanDescription(description) {
    if (!description) {
      return null;
    }
    const withBreaks = description.replace(HelloWorkConfig.HTML_BREAK_PATTERN, "\n");
    const stripped = withBreaks.replace(HelloWorkConfig.HTML_TAG_PATTERN, EMPTY_STRING);
    const decoded = this.decodeEntities(stripped);
    return decoded.replace(HelloWorkConfig.EXCESS_BLANK_LINES_PATTERN, "\n\n").trim();
  }

  /**
   * Decode the common HTML entities found in HelloWork descriptions.
   * @param {string} text - The text to decode.
   * @returns {string} The decoded text.
   */
  decodeEntities(text) {
    return text
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#0*39;/g, "'")
      .replace(/&#(\d+);/g, (whole, code) => {
        return String.fromCharCode(Number(code));
      })
      .replace(/&#x([0-9a-f]+);/gi, (whole, code) => {
        return String.fromCharCode(Number.parseInt(code, HelloWorkConfig.HEX_RADIX));
      });
  }

  /**
   * Convert a JSON-LD datePosted into an ISO timestamp.
   * @param {string|null} value - The raw datePosted value.
   * @returns {string|null} The ISO date, or null when invalid.
   */
  toIsoDate(value) {
    if (!value) {
      return null;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString();
  }

  /**
   * Map a JSON-LD baseSalary to the canonical salary shape.
   * @param {object|undefined} baseSalary - The JSON-LD baseSalary.
   * @returns {object|null} The canonical salary, or null when absent.
   */
  parseDetailSalary(baseSalary) {
    if (!baseSalary || !baseSalary.value) {
      return null;
    }
    const amount = baseSalary.value;
    const min = this.toNumber(amount.minValue ?? amount.value);
    const max = this.toNumber(amount.maxValue);
    if (min === null && max === null) {
      return null;
    }
    const unit = amount.unitText ? String(amount.unitText).toUpperCase() : null;
    return {
      min,
      max,
      currency: baseSalary.currency ?? null,
      period: HelloWorkConfig.SALARY_UNIT_MAP[unit] ?? HelloWorkConfig.DEFAULT_SALARY_PERIOD,
      raw: null,
    };
  }

  /**
   * Coerce a value to a finite number, or null when it is not numeric.
   * @param {unknown} value - The value to coerce.
   * @returns {number|null} The number, or null.
   */
  toNumber(value) {
    if (value === null || value === undefined || value === EMPTY_STRING) {
      return null;
    }
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  /**
   * Build the HelloWork search URL from the criteria.
   * @param {string} keywords - The searched keywords.
   * @param {string|null} location - The searched location.
   * @returns {string} The search URL.
   */
  buildSearchUrl(keywords, location) {
    const url = new URL(HelloWorkConfig.SEARCH_PATH, HelloWorkConfig.BASE_URL);
    url.searchParams.set(HelloWorkConfig.KEYWORDS_PARAM, keywords);
    if (location) {
      url.searchParams.set(HelloWorkConfig.LOCATION_PARAM, location);
    }
    return url.toString();
  }

  /**
   * Create the hidden window used to load and scrape HelloWork.
   * @returns {BrowserWindow} The hidden scraping window.
   */
  createWindow() {
    return new BrowserWindow({
      width: HelloWorkConfig.WINDOW_WIDTH,
      height: HelloWorkConfig.WINDOW_HEIGHT,
      show: false,
      webPreferences: {
        partition: HelloWorkConfig.SESSION_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
  }

  /**
   * Load a URL in the window, resolving on completion and rejecting when the
   * load does not finish within the configured timeout.
   * @param {BrowserWindow} scrapingWindow - The window to load into.
   * @param {string} url - The URL to load.
   * @returns {Promise<void>} Resolves once the page has finished loading.
   */
  loadWithTimeout(scrapingWindow, url) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("HelloWork load timed out"));
      }, HelloWorkConfig.LOAD_TIMEOUT_MS);
      scrapingWindow.webContents.once("did-finish-load", () => {
        clearTimeout(timer);
        resolve();
      });
      scrapingWindow.loadURL(url, { userAgent: HelloWorkConfig.USER_AGENT });
    });
  }

  /**
   * Map a raw scraped card to the canonical offer shape used by the UI.
   * @param {object} raw - The raw card fields extracted from the DOM.
   * @returns {object} The canonical offer.
   */
  normalizeOffer(raw) {
    const ariaLabel = raw.ariaLabel ?? EMPTY_STRING;
    const place = this.parseLocation(ariaLabel);
    return {
      source: HelloWorkConfig.SOURCE,
      sourceId: raw.id,
      title: raw.title,
      description: null,
      company: { name: raw.company ?? null },
      location: {
        label: place.label,
        city: place.city,
        postalCode: null,
        latitude: null,
        longitude: null,
        country: HelloWorkConfig.COUNTRY,
      },
      contractType: this.parseContractType(ariaLabel),
      contractTypeLabel: null,
      salary: null,
      applyUrl: raw.href ? `${HelloWorkConfig.BASE_URL}${raw.href}` : null,
      publishedAt: this.parseRelativeDate(raw.cardText ?? EMPTY_STRING),
      alternates: [],
    };
  }

  /**
   * Extract the location from the aria-label. The location always sits right
   * before ", chez <company>"; taking the last " à " avoids matching an " à "
   * that appears inside the job title itself.
   * @param {string} ariaLabel - The offer link aria-label.
   * @returns {{label: string|null, city: string|null}} The parsed location.
   */
  parseLocation(ariaLabel) {
    const beforeCompany = ariaLabel.split(HelloWorkConfig.COMPANY_DELIMITER)[FIRST_PART_INDEX];
    const prefixIndex = beforeCompany.lastIndexOf(HelloWorkConfig.LOCATION_PREFIX);
    if (prefixIndex < 0) {
      return { label: null, city: null };
    }
    const label = beforeCompany.slice(prefixIndex + HelloWorkConfig.LOCATION_PREFIX.length).trim();
    const city = label.split(HelloWorkConfig.CITY_DEPARTMENT_SEPARATOR)[FIRST_PART_INDEX].trim();
    return { label, city };
  }

  /**
   * Extract and canonicalize the contract type from the aria-label.
   * @param {string} ariaLabel - The offer link aria-label.
   * @returns {string} The canonical contract type.
   */
  parseContractType(ariaLabel) {
    const match = ariaLabel.match(HelloWorkConfig.CONTRACT_PATTERN);
    if (!match) {
      return HelloWorkConfig.DEFAULT_CONTRACT_TYPE;
    }
    const key = match[FIRST_MATCH_GROUP]
      .toLowerCase()
      .normalize("NFD")
      .replace(DIACRITICS_PATTERN, EMPTY_STRING)
      .trim();
    return HelloWorkConfig.CONTRACT_TYPE_MAP[key] ?? HelloWorkConfig.DEFAULT_CONTRACT_TYPE;
  }

  /**
   * Convert a relative "il y a X jours" mention into an approximate ISO date.
   * HelloWork cards only expose a relative age, so the result is approximate.
   * @param {string} cardText - The visible card text.
   * @returns {string|null} The approximate ISO publication date, or null.
   */
  parseRelativeDate(cardText) {
    const match = cardText.match(HelloWorkConfig.RELATIVE_DATE_PATTERN);
    if (!match) {
      return null;
    }
    const count = Number(match[FIRST_MATCH_GROUP]);
    const unit = match[SECOND_MATCH_GROUP].toLowerCase();
    const unitMs = HelloWorkConfig.RELATIVE_UNIT_MS[unit];
    if (!unitMs) {
      return null;
    }
    return new Date(Date.now() - count * unitMs).toISOString();
  }
}

module.exports = { HelloWorkScraper };
