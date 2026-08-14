/**
 * Coordinates the native confirmation emitted when the renderer blocks an unload.
 */
class UnsavedChangesUnloadGuard {
  static STAY_RESPONSE = 0;

  static CONTINUE_RESPONSE = 1;

  /**
   * Create the guard with Electron's native dialog dependency.
   * @param {object} dialog - Electron dialog module.
   */
  constructor(dialog) {
    this.dialog = dialog;
  }

  /**
   * Attach one unload handler to one live BrowserWindow.
   * @param {object} browserWindow - BrowserWindow to protect.
   * @returns {void}
   */
  attach(browserWindow) {
    browserWindow.webContents.on("will-prevent-unload", (event) => {
      this.handle(event, browserWindow);
    });
  }

  /**
   * Ask whether one renderer-requested unload may discard CandidateDossier changes.
   * @param {object} event - Electron will-prevent-unload event.
   * @param {object} browserWindow - Parent window for the native dialog.
   * @returns {void}
   */
  handle(event, browserWindow) {
    const response = this.dialog.showMessageBoxSync(browserWindow, {
      type: "warning",
      title: "Modifications non enregistrées",
      message: "Vous avez des modifications qui n'ont pas été enregistrées.",
      detail: "Si vous continuez, ces modifications seront perdues.",
      buttons: ["Rester", "Continuer sans enregistrer"],
      defaultId: UnsavedChangesUnloadGuard.STAY_RESPONSE,
      cancelId: UnsavedChangesUnloadGuard.STAY_RESPONSE,
      noLink: true,
    });
    if (response === UnsavedChangesUnloadGuard.CONTINUE_RESPONSE) {
      event.preventDefault();
    }
  }
}

module.exports = { UnsavedChangesUnloadGuard };
