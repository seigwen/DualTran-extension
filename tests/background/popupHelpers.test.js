import { describe, expect, it } from "vitest";
import {
  buildBrowserActionPopupConfig,
  buildPageActionPopupConfig,
  resolvePopupPath,
} from "../../src/background/popupHelpers.js";

describe("popupHelpers", () => {
  it("returns null when translateClickingOnce is enabled without forceShow", () => {
    expect(
      resolvePopupPath({
        translateClickingOnce: "yes",
        useOldPopup: "no",
      })
    ).toBe(null);
  });

  it("returns the old popup path when forceShow overrides translateClickingOnce", () => {
    expect(
      resolvePopupPath({
        translateClickingOnce: "yes",
        useOldPopup: "yes",
        forceShow: true,
      })
    ).toBe("popup/old-popup.html");
  });

  it("returns the new popup path when old popup is disabled", () => {
    expect(
      resolvePopupPath({
        translateClickingOnce: "no",
        useOldPopup: "no",
      })
    ).toBe("popup/popup.html");
  });

  it("builds pageAction popup config with the tab id", () => {
    expect(
      buildPageActionPopupConfig(18, {
        translateClickingOnce: "no",
        useOldPopup: "yes",
      })
    ).toEqual({
      popup: "popup/old-popup.html",
      tabId: 18,
    });
  });

  it("builds browserAction popup config without a tab id", () => {
    expect(
      buildBrowserActionPopupConfig({
        translateClickingOnce: "yes",
        useOldPopup: "no",
      })
    ).toEqual({
      popup: null,
    });
  });
});