const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { HelloWorkScraper } = require("../../electron/scrapers/HelloWorkScraper.cjs");
const { HelloWorkUrlPolicy } = require("../../electron/scrapers/HelloWorkUrlPolicy.cjs");

const ALLOWED_URL = "https://www.hellowork.com/fr-fr/emplois/123.html";
const OTHER_ALLOWED_URL = "https://www.hellowork.com/fr-fr/emplois/456.html";
const FORBIDDEN_URL = "https://example.com/fr-fr/emplois/123.html";

/**
 * Create an event carrying an observable preventDefault operation.
 * @returns {object} Electron-like event.
 */
function createEvent() {
  return {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}

/**
 * Fake Electron session exposing permission and download controls.
 */
class FakeSession extends EventEmitter {
  /**
   * Store the current permission request handler.
   * @param {Function|null} handler - Permission handler.
   * @returns {void}
   */
  setPermissionRequestHandler(handler) {
    this.permissionRequestHandler = handler;
  }

  /**
   * Store the current permission check handler.
   * @param {Function|null} handler - Permission checker.
   * @returns {void}
   */
  setPermissionCheckHandler(handler) {
    this.permissionCheckHandler = handler;
  }
}

/**
 * Fake Electron web contents used to exercise DETAIL protections.
 */
class FakeWebContents extends EventEmitter {
  /**
   * Create fake web contents with one final URL and JSON-LD result.
   * @param {string} finalUrl - URL reported after loading.
   * @param {unknown} scriptResult - Extraction result.
   */
  constructor(finalUrl, scriptResult) {
    super();
    this.finalUrl = finalUrl;
    this.scriptResult = scriptResult;
    this.session = new FakeSession();
  }

  /**
   * Store the popup decision handler.
   * @param {Function} handler - Popup handler.
   * @returns {void}
   */
  setWindowOpenHandler(handler) {
    this.windowOpenHandler = handler;
  }

  /**
   * Return the simulated final loaded URL.
   * @returns {string} Final URL.
   */
  getURL() {
    return this.finalUrl;
  }

  /**
   * Return the simulated in-page extraction result.
   * @returns {Promise<unknown>} Script result.
   */
  async executeJavaScript() {
    return this.scriptResult;
  }
}

/**
 * Build a fake BrowserWindow class for one DETAIL scenario.
 * @param {string} finalUrl - URL reported after loading.
 * @param {unknown} scriptResult - Extraction result.
 * @returns {Function} BrowserWindow-compatible class.
 */
function createWindowClass(finalUrl, scriptResult, sharedSession = null) {
  return class FakeBrowserWindow {
    /**
     * Create a fake hidden window.
     */
    constructor() {
      this.webContents = new FakeWebContents(finalUrl, scriptResult);
      if (sharedSession) {
        this.webContents.session = sharedSession;
      }
      FakeBrowserWindow.instance = this;
    }

    /**
     * Mark the fake window destroyed.
     * @returns {void}
     */
    destroy() {
      this.destroyed = true;
    }
  };
}

/**
 * Create a scraper whose load completes without real network access.
 * @param {Function} browserWindowClass - Fake BrowserWindow class.
 * @returns {HelloWorkScraper} Offline scraper.
 */
function createOfflineScraper(browserWindowClass) {
  const scraper = new HelloWorkScraper({ browserWindowClass });
  scraper.loadWithTimeout = async () => {};
  return scraper;
}

test("HelloWork URL policy accepts only the exact credential-free HTTPS origin", () => {
  const policy = new HelloWorkUrlPolicy();

  assert.equal(policy.isAllowed(ALLOWED_URL), true);
  assert.equal(policy.isAllowed(ALLOWED_URL.replace("https:", "http:")), false);
  assert.equal(policy.isAllowed(FORBIDDEN_URL), false);
  assert.equal(policy.isAllowed("https://jobs.hellowork.com/test"), false);
  assert.equal(policy.isAllowed("https://user:pass@www.hellowork.com/test"), false);
});

test("DETAIL protections refuse foreign navigation, popups, permissions and downloads", () => {
  const WindowClass = createWindowClass(ALLOWED_URL, []);
  const scraper = createOfflineScraper(WindowClass);
  const window = new WindowClass();
  const cleanup = scraper.secureDetailWindow(window);
  const navigationEvent = createEvent();
  const allowedNavigationEvent = createEvent();
  const downloadEvent = createEvent();
  let permissionGranted = true;

  window.webContents.emit("will-navigate", navigationEvent, FORBIDDEN_URL);
  window.webContents.emit("will-navigate", allowedNavigationEvent, OTHER_ALLOWED_URL);
  window.webContents.session.emit("will-download", downloadEvent);
  window.webContents.session.permissionRequestHandler(null, "camera", (granted) => {
    permissionGranted = granted;
  });

  assert.equal(navigationEvent.prevented, true);
  assert.equal(allowedNavigationEvent.prevented, false);
  assert.deepEqual(window.webContents.windowOpenHandler(), { action: "deny" });
  assert.equal(permissionGranted, false);
  assert.equal(window.webContents.session.permissionCheckHandler(), false);
  assert.equal(downloadEvent.prevented, true);
  cleanup();
  assert.equal(typeof window.webContents.session.permissionRequestHandler, "function");
  assert.equal(typeof window.webContents.session.permissionCheckHandler, "function");
});

test("concurrent DETAIL cleanup keeps shared session permission protections active", () => {
  const sharedSession = new FakeSession();
  const WindowClass = createWindowClass(ALLOWED_URL, [], sharedSession);
  const scraper = createOfflineScraper(WindowClass);
  const firstWindow = new WindowClass();
  const secondWindow = new WindowClass();
  const cleanupFirst = scraper.secureDetailWindow(firstWindow);
  const cleanupSecond = scraper.secureDetailWindow(secondWindow);
  const requestHandler = sharedSession.permissionRequestHandler;
  const checkHandler = sharedSession.permissionCheckHandler;

  cleanupFirst();

  assert.equal(sharedSession.permissionRequestHandler, requestHandler);
  assert.equal(sharedSession.permissionCheckHandler, checkHandler);
  assert.equal(sharedSession.permissionCheckHandler(), false);
  assert.equal(secondWindow.webContents.listenerCount("will-navigate"), 1);
  assert.equal(sharedSession.listenerCount("will-download"), 1);

  cleanupSecond();

  assert.equal(sharedSession.permissionRequestHandler, requestHandler);
  assert.equal(sharedSession.permissionCheckHandler, checkHandler);
  assert.equal(secondWindow.webContents.listenerCount("will-navigate"), 0);
  assert.equal(sharedSession.listenerCount("will-download"), 0);
});

test("DETAIL rejects forbidden initial and final URLs without returning content", async () => {
  const directJson = JSON.stringify({ "@type": "JobPosting", description: "Valid" });
  const WindowClass = createWindowClass(FORBIDDEN_URL, [directJson]);
  const scraper = createOfflineScraper(WindowClass);

  await assert.rejects(() => {
    return scraper.fetchDetail(FORBIDDEN_URL);
  }, /not allowed/);
  await assert.rejects(() => {
    return scraper.fetchDetail(ALLOWED_URL);
  }, /final URL is not allowed/);
  assert.equal(WindowClass.instance.destroyed, true);
});

test("DETAIL timeout destroys its window and removes window-specific listeners", async () => {
  const sharedSession = new FakeSession();
  const WindowClass = createWindowClass(ALLOWED_URL, [], sharedSession);
  const scraper = new HelloWorkScraper({ browserWindowClass: WindowClass });
  scraper.loadWithTimeout = async () => {
    throw new Error("HelloWork load timed out");
  };

  await assert.rejects(() => {
    return scraper.fetchDetail(ALLOWED_URL);
  }, /timed out/);

  assert.equal(WindowClass.instance.destroyed, true);
  assert.equal(WindowClass.instance.webContents.listenerCount("will-navigate"), 0);
  assert.equal(WindowClass.instance.webContents.listenerCount("will-redirect"), 0);
  assert.equal(sharedSession.listenerCount("will-download"), 0);
  assert.equal(typeof sharedSession.permissionRequestHandler, "function");
  assert.equal(typeof sharedSession.permissionCheckHandler, "function");
});

test("JSON-LD parser supports direct, graph and array JobPosting types", () => {
  const scraper = createOfflineScraper(createWindowClass(ALLOWED_URL, []));
  const direct = scraper.findJobPosting([
    JSON.stringify({ "@type": "JobPosting", description: "Direct" }),
  ]);
  const graph = scraper.findJobPosting([
    JSON.stringify({
      "@graph": [
        { "@type": "Organization", name: "Example" },
        { "@type": ["Thing", "JobPosting"], description: "Graph" },
      ],
    }),
  ]);

  assert.equal(direct.description, "Direct");
  assert.equal(graph.description, "Graph");
});

test("JSON-LD parser rejects invalid JSON, non-postings and empty descriptions", () => {
  const scraper = createOfflineScraper(createWindowClass(ALLOWED_URL, []));

  assert.equal(scraper.findJobPosting(["invalid JSON"]), null);
  assert.equal(scraper.findJobPosting([
    JSON.stringify({ "@type": "Organization", description: "Not a job" }),
  ]), null);
  assert.equal(scraper.findJobPosting([
    JSON.stringify({ "@type": "JobPosting", description: " " }),
  ]), null);
});

test("valid DETAIL returns cleaned description and final source URL", async () => {
  const posting = JSON.stringify({
    "@type": "JobPosting",
    description: "<p>PremiÃ¨re mission</p><p>Seconde mission</p>",
    datePosted: "2026-08-01T10:00:00Z",
  });
  const WindowClass = createWindowClass(ALLOWED_URL, [posting]);
  const scraper = createOfflineScraper(WindowClass);
  const detail = await scraper.fetchDetail(ALLOWED_URL);

  assert.equal(detail.description, "PremiÃ¨re mission\nSeconde mission");
  assert.equal(detail.sourceUrl, ALLOWED_URL);
  assert.equal(WindowClass.instance.destroyed, true);
});

test("HelloWork SEARCH normalization remains description-free", () => {
  const scraper = createOfflineScraper(createWindowClass(ALLOWED_URL, []));
  const offer = scraper.normalizeOffer({
    id: "hello-1",
    title: "Developer",
    company: "Example",
    href: "/fr-fr/emplois/123.html",
    ariaLabel: "",
    cardText: "",
  });

  assert.equal(offer.description, null);
});
