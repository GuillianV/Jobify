const { randomUUID, createHash } = require("node:crypto");
const { writeFile } = require("node:fs/promises");
const { BrowserWindow, session } = require("electron");
const { HelloWorkAuditConfig } = require("./HelloWorkAuditConfig.cjs");

const SEARCH_EXTRACTION_SCRIPT = `
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

const JSON_LD_EXTRACTION_SCRIPT = `
  (function () {
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    return Array.prototype.map.call(scripts, function (script) {
      return script.textContent;
    });
  })();
`;

/**
 * Electron-only orchestration for the isolated empirical HelloWork audit.
 */
class HelloWorkAudit {
  /**
   * Create the audit with explicit production-compatible pure dependencies.
   * @param {object} dependencies - Audit dependencies.
   * @param {object} dependencies.options - Validated CLI options.
   * @param {object} dependencies.urlPolicy - Pure URL policy.
   * @param {object} dependencies.jsonLdAnalyzer - Pure JSON-LD analyzer.
   * @param {object} dependencies.helloWorkScraper - Production pure mapping helpers.
   * @param {typeof writeFile} [dependencies.writeFileImplementation] - Injectable writer.
   */
  constructor({
    options,
    urlPolicy,
    jsonLdAnalyzer,
    helloWorkScraper,
    writeFileImplementation = writeFile,
  }) {
    this.options = options;
    this.urlPolicy = urlPolicy;
    this.jsonLdAnalyzer = jsonLdAnalyzer;
    this.helloWorkScraper = helloWorkScraper;
    this.writeFileImplementation = writeFileImplementation;
    this.partition = `${HelloWorkAuditConfig.SESSION_PREFIX}${randomUUID()}`;
    this.auditSession = null;
  }

  /**
   * Execute one search and sequentially inspect its eligible details.
   * @returns {Promise<object>} Safe report written outside the repository by convention.
   */
  async run() {
    this.configureSession();
    try {
      const search = await this.runSearch();
      const detailReports = [];
      for (const candidate of search.candidates) {
        detailReports.push(await this.runDetail(candidate));
      }
      const report = this.buildReport(search, detailReports);
      const serialized = JSON.stringify(
        report,
        null,
        HelloWorkAuditConfig.REPORT_INDENTATION,
      );
      await this.writeFileImplementation(this.options.outputPath, serialized, "utf8");
      return report;
    } finally {
      if (this.auditSession) {
        await this.auditSession.clearStorageData();
      }
    }
  }

  /**
   * Create and lock down the non-persistent audit session.
   * @returns {void}
   */
  configureSession() {
    this.auditSession = session.fromPartition(this.partition);
    this.auditSession.setPermissionRequestHandler((webContents, permission, callback) => {
      void webContents;
      void permission;
      callback(false);
    });
    if (typeof this.auditSession.setPermissionCheckHandler === "function") {
      this.auditSession.setPermissionCheckHandler(() => {
        return false;
      });
    }
    this.auditSession.on("will-download", (event) => {
      event.preventDefault();
    });
  }

  /**
   * Load and extract the controlled HelloWork search page.
   * @returns {Promise<object>} Search measurements and in-memory candidates.
   */
  async runSearch() {
    const searchUrl = this.buildSearchUrl();
    const page = await this.runPage(searchUrl, SEARCH_EXTRACTION_SCRIPT);
    if (!page.success || !Array.isArray(page.extracted)) {
      return {
        ...page,
        extractedOfferCount: 0,
        eligibleDetailCount: 0,
        selectedDetailCount: 0,
        candidates: [],
      };
    }
    const candidates = [];
    let eligibleDetailCount = 0;
    for (const raw of page.extracted) {
      const normalized = this.helloWorkScraper.normalizeOffer(raw);
      const validation = this.urlPolicy.validate(normalized.applyUrl);
      if (!validation.allowed) {
        continue;
      }
      eligibleDetailCount += 1;
      if (candidates.length < this.options.maximumDetails) {
        candidates.push({
          sourceId: normalized.sourceId,
          applyUrl: normalized.applyUrl,
          title: normalized.title,
          company: normalized.company?.name ?? null,
          location: normalized.location?.label ?? normalized.location?.city ?? null,
          publishedAt: normalized.publishedAt,
        });
      }
    }
    return {
      ...page,
      extractedOfferCount: page.extracted.length,
      eligibleDetailCount,
      selectedDetailCount: candidates.length,
      candidates,
    };
  }

  /**
   * Load one detail, analyze all JSON-LD and compare every JobPosting candidate.
   * @param {object} candidate - Search-derived candidate held in memory.
   * @returns {Promise<object>} Safe detail report.
   */
  async runDetail(candidate) {
    const page = await this.runPage(candidate.applyUrl, JSON_LD_EXTRACTION_SCRIPT);
    const jsonLd = this.jsonLdAnalyzer.analyzeScripts(page.success ? page.extracted : []);
    const comparison = this.jsonLdAnalyzer.compareSearchToJobPostings(candidate, jsonLd.jobPostings);
    return {
      search: {
        sourceIdHash: this.hash(String(candidate.sourceId ?? "")),
        applyUrlHash: this.hash(candidate.applyUrl),
        titleHash: this.hash(String(candidate.title ?? "")),
        companyHash: this.hash(String(candidate.company ?? "")),
        locationHash: this.hash(String(candidate.location ?? "")),
      },
      load: this.toSafePageResult(page),
      jsonLd: this.jsonLdAnalyzer.toSafeAnalysis(jsonLd),
      comparison,
    };
  }

  /**
   * Build the fixed HelloWork search URL from CLI criteria.
   * @returns {string} Validated search URL.
   */
  buildSearchUrl() {
    const url = new URL(HelloWorkAuditConfig.SEARCH_PATH, HelloWorkAuditConfig.ALLOWED_ORIGIN);
    url.searchParams.set(HelloWorkAuditConfig.KEYWORDS_PARAMETER, this.options.keywords);
    if (this.options.location) {
      url.searchParams.set(HelloWorkAuditConfig.LOCATION_PARAMETER, this.options.location);
    }
    return url.toString();
  }

  /**
   * Load one allowed page, observe navigation and execute a fixed extraction script.
   * @param {string} url - Internally sourced URL.
   * @param {string} extractionScript - Fixed audit extraction script.
   * @returns {Promise<object>} Page result with safe navigation metadata.
   */
  async runPage(url, extractionScript) {
    const initialValidation = this.urlPolicy.validate(url);
    if (!initialValidation.allowed) {
      return this.failedPage("INITIAL_URL_REJECTED", initialValidation);
    }
    const scrapingWindow = this.createWindow();
    try {
      const load = await this.loadWithGuards(scrapingWindow, url, initialValidation);
      if (!load.success) {
        return load;
      }
      const finalValidation = this.urlPolicy.validate(scrapingWindow.webContents.getURL());
      load.navigation.final = finalValidation;
      if (!finalValidation.allowed) {
        return {
          ...load,
          success: false,
          failureCategory: "FINAL_ORIGIN_REFUSED",
        };
      }
      const finalUrl = scrapingWindow.webContents.getURL();
      load.navigation.finalUrlEqualsInitial = this.urlPolicy.urlsEqualIgnoringFragment(
        url,
        finalUrl,
      );
      const extraction = await this.executeExtractionWithTimeout(
        scrapingWindow.webContents,
        extractionScript,
      );
      if (!extraction.success) {
        return {
          ...load,
          success: false,
          failureCategory: extraction.failureCategory,
          extracted: null,
        };
      }
      return { ...load, extracted: extraction.extracted };
    } finally {
      scrapingWindow.destroy();
    }
  }

  /**
   * Execute the fixed page script with an independent timeout.
   * @param {Electron.WebContents} webContents - Loaded audit page contents.
   * @param {string} extractionScript - Fixed extraction script.
   * @returns {Promise<object>} Safe extraction result.
   */
  async executeExtractionWithTimeout(webContents, extractionScript) {
    let timeoutId;
    const execution = webContents.executeJavaScript(extractionScript, true)
      .then((extracted) => {
        return { success: true, failureCategory: null, extracted };
      })
      .catch(() => {
        return { success: false, failureCategory: "EXTRACTION_FAILED", extracted: null };
      });
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => {
        resolve({
          success: false,
          failureCategory: "EXTRACTION_TIMEOUT",
          extracted: null,
        });
      }, HelloWorkAuditConfig.EXTRACTION_TIMEOUT_MS);
    });
    try {
      return await Promise.race([execution, timeout]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Create a hidden sandboxed window in the dedicated in-memory partition.
   * @returns {BrowserWindow} Audit window.
   */
  createWindow() {
    return new BrowserWindow({
      width: HelloWorkAuditConfig.WINDOW_WIDTH,
      height: HelloWorkAuditConfig.WINDOW_HEIGHT,
      show: false,
      webPreferences: {
        partition: this.partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
  }

  /**
   * Load a page with timeout, navigation guards and safe timing measurements.
   * @param {BrowserWindow} scrapingWindow - Audit window.
   * @param {string} url - Validated URL.
   * @param {object} initialValidation - Safe initial validation.
   * @returns {Promise<object>} Safe load result.
   */
  loadWithGuards(scrapingWindow, url, initialValidation) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      let settled = false;
      const navigation = {
        initial: initialValidation,
        final: null,
        redirectCount: 0,
        refusedRedirectCount: 0,
        refusedNavigationCount: 0,
        finalUrlEqualsInitial: null,
      };
      /**
       * Settle the guarded load once with safe measurements.
       * @param {boolean} success - Whether the load completed.
       * @param {string|null} failureCategory - Fixed failure category.
       * @param {boolean} timeout - Whether a timeout caused settlement.
       * @returns {void}
       */
      function finish(success, failureCategory, timeout = false) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({
          success,
          failureCategory,
          timeout,
          loadDurationMs: Date.now() - startedAt,
          navigation,
          extracted: null,
        });
      }
      const timer = setTimeout(() => {
        finish(false, "LOAD_TIMEOUT", true);
      }, HelloWorkAuditConfig.LOAD_TIMEOUT_MS);
      scrapingWindow.webContents.setWindowOpenHandler(() => {
        return { action: "deny" };
      });
      scrapingWindow.webContents.on("will-navigate", (event, targetUrl) => {
        const decision = this.urlPolicy.guardNavigation(event, targetUrl, true);
        if (!decision.allowed) {
          navigation.refusedNavigationCount += 1;
          finish(false, "NAVIGATION_REFUSED");
        }
      });
      scrapingWindow.webContents.on("will-redirect", (event, targetUrl, isInPlace, isMainFrame) => {
        void isInPlace;
        if (isMainFrame) {
          navigation.redirectCount += 1;
        }
        const decision = this.urlPolicy.guardNavigation(event, targetUrl, isMainFrame);
        if (!decision.allowed) {
          navigation.refusedRedirectCount += 1;
          finish(false, "REDIRECT_REFUSED");
        }
      });
      scrapingWindow.webContents.once("did-finish-load", () => {
        finish(true, null);
      });
      scrapingWindow.webContents.on(
        "did-fail-load",
        (event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
          void event;
          void errorCode;
          void errorDescription;
          void validatedUrl;
          if (isMainFrame) {
            finish(false, "LOAD_FAILED");
          }
        },
      );
      scrapingWindow.loadURL(url, { userAgent: HelloWorkAuditConfig.USER_AGENT }).catch(() => {
        finish(false, "LOAD_FAILED");
      });
    });
  }

  /**
   * Build a safe failed page result.
   * @param {string} failureCategory - Fixed failure category.
   * @param {object} initialValidation - Safe initial validation.
   * @returns {object} Failed page result.
   */
  failedPage(failureCategory, initialValidation) {
    return {
      success: false,
      failureCategory,
      timeout: false,
      loadDurationMs: 0,
      navigation: {
        initial: initialValidation,
        final: null,
        redirectCount: 0,
        refusedRedirectCount: 0,
        refusedNavigationCount: 0,
        finalUrlEqualsInitial: null,
      },
      extracted: null,
    };
  }

  /**
   * Remove extracted page data and retain only safe load measurements.
   * @param {object} page - Internal page result.
   * @returns {object} Safe page result.
   */
  toSafePageResult(page) {
    const { extracted, ...safePage } = page;
    void extracted;
    return safePage;
  }

  /**
   * Build the global safe report and aggregates.
   * @param {object} search - Internal search result.
   * @param {object[]} offers - Safe detail reports.
   * @returns {object} Serializable report.
   */
  buildReport(search, offers) {
    return this.jsonLdAnalyzer.buildReport({
      options: this.options,
      search,
      offers,
    });
  }

  /**
   * Hash a value for safe identity correlation.
   * @param {string} value - Value to hash.
   * @returns {string} Hexadecimal SHA-256 digest.
   */
  hash(value) {
    return createHash(HelloWorkAuditConfig.HASH_ALGORITHM)
      .update(value)
      .digest(HelloWorkAuditConfig.HASH_ENCODING);
  }
}

module.exports = { HelloWorkAudit };
