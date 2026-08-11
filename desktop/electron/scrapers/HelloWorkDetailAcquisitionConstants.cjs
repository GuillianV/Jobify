/**
 * Stable Electron contract for public HelloWork DETAIL acquisition results.
 */
class HelloWorkDetailAcquisitionConstants {
  static KIND = "HELLOWORK_DETAIL";

  static SOURCE = "hellowork";

  static STATUS = Object.freeze({
    ACQUIRED: "ACQUIRED",
    NOT_FOUND: "NOT_FOUND",
    FAILED: "FAILED",
  });
}

module.exports = { HelloWorkDetailAcquisitionConstants };
