const { contextBridge, ipcRenderer } = require("electron");

const BRIDGE_NAMESPACE = "jobify";
const OPEN_EXTERNAL_CHANNEL = "jobify:open-external";
const SCRAPE_HELLOWORK_CHANNEL = "jobify:scrape-hellowork";
const FETCH_DETAIL_CHANNEL = "jobify:fetch-offer-detail";

/**
 * Exposes a controlled, secure API from the Electron main process to the
 * renderer through the context bridge. Provider DETAIL acquisition returns a
 * discriminated result without exposing Electron errors. Opening external
 * links is delegated to the main process over IPC, because the shell module is
 * not available in a sandboxed preload.
 */
class PreloadBridge {
  /**
   * Build the payload exposed to the renderer.
   * @returns {object} The exposed API.
   */
  buildApi() {
    return {
      versions: {
        node: process.versions.node,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
      },
      openExternal: (url) => {
        return ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url);
      },
      scrapeHelloWork: (keywords, location) => {
        return ipcRenderer.invoke(SCRAPE_HELLOWORK_CHANNEL, { keywords, location });
      },
      fetchOfferDetail: (request) => {
        return ipcRenderer.invoke(FETCH_DETAIL_CHANNEL, request);
      },
    };
  }

  /**
   * Register the API on the renderer global scope.
   * @returns {void}
   */
  expose() {
    contextBridge.exposeInMainWorld(BRIDGE_NAMESPACE, this.buildApi());
  }
}

const bridge = new PreloadBridge();
bridge.expose();
