const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const { WindowConfig } = require("./WindowConfig.cjs");
const { HelloWorkScraper } = require("./scrapers/HelloWorkScraper.cjs");
const { HelloWorkUrlPolicy } = require("./scrapers/HelloWorkUrlPolicy.cjs");
const {
  HelloWorkDetailAcquisition,
} = require("./scrapers/HelloWorkDetailAcquisition.cjs");

const NO_OPEN_WINDOWS = 0;
const OPEN_EXTERNAL_CHANNEL = "jobify:open-external";
const SCRAPE_HELLOWORK_CHANNEL = "jobify:scrape-hellowork";
const FETCH_DETAIL_CHANNEL = "jobify:fetch-offer-detail";
const EXTERNAL_URL_PATTERN = /^https?:\/\//;

/**
 * Manages the creation and content loading of the main browser window.
 */
class MainWindow {
  /**
   * Create the manager without opening a window yet.
   */
  constructor() {
    this.browserWindow = null;
  }

  /**
   * Create the browser window and load its content.
   * @returns {void}
   */
  create() {
    this.browserWindow = new BrowserWindow({
      width: WindowConfig.WIDTH,
      height: WindowConfig.HEIGHT,
      title: WindowConfig.TITLE,
      webPreferences: {
        preload: path.join(__dirname, WindowConfig.PRELOAD_FILE),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this.load();
  }

  /**
   * Load the renderer content, using the built files in production and the
   * Vite dev server otherwise.
   * @returns {void}
   */
  load() {
    if (app.isPackaged) {
      this.browserWindow.loadFile(
        path.join(__dirname, WindowConfig.PRODUCTION_ENTRY),
      );
      return;
    }
    this.browserWindow.loadURL(WindowConfig.DEV_SERVER_URL);
    this.browserWindow.webContents.openDevTools();
  }
}

/**
 * Bootstraps the Electron application and its lifecycle event handlers.
 */
class ElectronApplication {
  /**
   * Create the application controller with its main window manager and the
   * client-side HelloWork scraper.
   */
  constructor() {
    this.mainWindow = new MainWindow();
    const helloWorkUrlPolicy = new HelloWorkUrlPolicy();
    this.helloWorkScraper = new HelloWorkScraper({ urlPolicy: helloWorkUrlPolicy });
    this.helloWorkDetailAcquisition = new HelloWorkDetailAcquisition(
      this.helloWorkScraper,
      helloWorkUrlPolicy,
    );
  }

  /**
   * Register IPC handlers, lifecycle handlers, and open the first window.
   * @returns {void}
   */
  start() {
    this.registerIpcHandlers();
    app.whenReady().then(() => {
      this.mainWindow.create();
      this.registerActivation();
    });
    this.registerWindowClose();
  }

  /**
   * Register the IPC handlers the renderer is allowed to call. Opening a URL
   * is done here because the shell module is unavailable in a sandboxed
   * preload; only validated http(s) URLs are opened.
   * @returns {void}
   */
  registerIpcHandlers() {
    ipcMain.handle(OPEN_EXTERNAL_CHANNEL, (event, url) => {
      if (typeof url === "string" && EXTERNAL_URL_PATTERN.test(url)) {
        return shell.openExternal(url);
      }
      return Promise.resolve();
    });
    ipcMain.handle(SCRAPE_HELLOWORK_CHANNEL, async (event, request) => {
      try {
        return await this.helloWorkScraper.search(request.keywords, request.location);
      } catch (error) {
        console.warn(`HelloWork scraping failed: ${error.message}`);
        return [];
      }
    });
    ipcMain.handle(FETCH_DETAIL_CHANNEL, async (event, request) => {
      return this.helloWorkDetailAcquisition.acquire(request);
    });
  }

  /**
   * Recreate a window when the application is activated with none open.
   * @returns {void}
   */
  registerActivation() {
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === NO_OPEN_WINDOWS) {
        this.mainWindow.create();
      }
    });
  }

  /**
   * Quit the application when every window is closed, except on macOS.
   * @returns {void}
   */
  registerWindowClose() {
    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") {
        app.quit();
      }
    });
  }
}

const application = new ElectronApplication();
application.start();
