import { describe, expect, it } from "vitest";
import {
  buildBrowserActionPopupConfig,
  buildPageActionPopupConfig,
  resolvePopupPath,
} from "../../src/background/popupHelpers.js";

describe("popup flow integration", () => {
  it("combines popup path resolution with browserAction popup config building", () => {
    const popupPath = resolvePopupPath({
      translateClickingOnce: "no",
      useOldPopup: "yes",
    });

    expect(popupPath).toBe("popup/old-popup.html");
    expect(buildBrowserActionPopupConfig({
      translateClickingOnce: "no",
      useOldPopup: "yes",
    })).toEqual({
      popup: "popup/old-popup.html",
    });
  });

  it("combines forceShow override with pageAction popup config building", () => {
    const popupPath = resolvePopupPath({
      translateClickingOnce: "yes",
      useOldPopup: "no",
      forceShow: true,
    });

    expect(popupPath).toBe("popup/popup.html");
    expect(buildPageActionPopupConfig(18, {
      translateClickingOnce: "yes",
      useOldPopup: "no",
      forceShow: true,
    })).toEqual({
      popup: "popup/popup.html",
      tabId: 18,
    });
  });
});