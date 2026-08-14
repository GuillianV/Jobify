const assert = require("node:assert/strict");
const test = require("node:test");
const {
  UnsavedChangesUnloadGuard,
} = require("../../electron/UnsavedChangesUnloadGuard.cjs");

/**
 * Build one guard scenario without creating an Electron BrowserWindow.
 * @param {number} response - Simulated native dialog response.
 * @returns {object} Scenario doubles and captured calls.
 */
function createScenario(response) {
  const calls = { dialogs: [], preventDefault: 0 };
  const dialog = {
    showMessageBoxSync: (browserWindow, options) => {
      calls.dialogs.push({ browserWindow, options });
      return response;
    },
  };
  const event = {
    preventDefault: () => {
      calls.preventDefault += 1;
    },
  };
  const browserWindow = { id: "main-window" };
  const guard = new UnsavedChangesUnloadGuard(dialog);
  return { browserWindow, calls, event, guard };
}

test("safe native response keeps the renderer unload blocked", () => {
  const scenario = createScenario(UnsavedChangesUnloadGuard.STAY_RESPONSE);

  scenario.guard.handle(scenario.event, scenario.browserWindow);

  assert.equal(scenario.calls.preventDefault, 0);
  assert.equal(scenario.calls.dialogs.length, 1);
  assert.equal(scenario.calls.dialogs[0].browserWindow, scenario.browserWindow);
  assert.equal(scenario.calls.dialogs[0].options.defaultId, 0);
  assert.equal(scenario.calls.dialogs[0].options.cancelId, 0);
});

test("explicit destructive response allows the unload exactly once", () => {
  const scenario = createScenario(UnsavedChangesUnloadGuard.CONTINUE_RESPONSE);

  scenario.guard.handle(scenario.event, scenario.browserWindow);

  assert.equal(scenario.calls.preventDefault, 1);
  assert.equal(scenario.calls.dialogs.length, 1);
});

test("guard attaches one will-prevent-unload handler to the supplied window", () => {
  const listeners = [];
  const browserWindow = {
    webContents: {
      on: (channel, handler) => {
        listeners.push({ channel, handler });
      },
    },
  };
  const guard = new UnsavedChangesUnloadGuard({ showMessageBoxSync: () => {
    return UnsavedChangesUnloadGuard.STAY_RESPONSE;
  } });

  guard.attach(browserWindow);

  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].channel, "will-prevent-unload");
  assert.equal(typeof listeners[0].handler, "function");
});
