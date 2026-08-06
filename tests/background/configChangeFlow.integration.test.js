import { describe, expect, it, vi } from "vitest";
import {
  resolveActionConfigChange,
  shouldRefreshIconsForConfigChange,
} from "../../src/background/configChangeHelpers.js";
import {
  applyBrowserActionPopupReset,
  applyPageActionPopupReset,
} from "../../src/background/popupExecutionHelpers.js";
import {
  buildAllTabIconRefreshPlan,
  buildIconEffectPlan,
} from "../../src/background/iconHelpers.js";

describe("config change flow integration", () => {
  it("combines translateClickingOnce changes with browser/page popup reset application", () => {
    const action = resolveActionConfigChange("translateClickingOnce");
    const setBrowserActionPopup = vi.fn();
    const setPageActionPopup = vi.fn();

    expect(action).toEqual({
      resetBrowserAction: true,
      resetActivePageAction: true,
    });

    applyBrowserActionPopupReset({
      forceShow: false,
      translateClickingOnce: "yes",
      useOldPopup: "no",
      setBrowserActionPopup,
    });
    applyPageActionPopupReset({
      tabId: 18,
      forceShow: false,
      translateClickingOnce: "yes",
      useOldPopup: "no",
      setPageActionPopup,
    });

    expect(setBrowserActionPopup).toHaveBeenCalledWith({
      popup: null,
    });
    expect(setPageActionPopup).toHaveBeenCalledWith({
      popup: null,
      tabId: 18,
    });
  });

  it("combines useOldPopup changes with browser popup reset and icon refresh targeting", () => {
    const action = resolveActionConfigChange("useOldPopup");
    const setBrowserActionPopup = vi.fn();

    expect(action).toEqual({
      resetBrowserAction: true,
      resetActivePageAction: false,
    });
    expect(shouldRefreshIconsForConfigChange("useOldPopup")).toBe(true);

    applyBrowserActionPopupReset({
      forceShow: false,
      translateClickingOnce: "no",
      useOldPopup: "yes",
      setBrowserActionPopup,
    });

    expect(setBrowserActionPopup).toHaveBeenCalledWith({
      popup: "popup/old-popup.html",
    });
    expect(buildAllTabIconRefreshPlan([{ id: 3 }, { id: 18 }, { url: "https://example.com" }])).toEqual([3, 18]);
  });

  it("combines showButtonInTheAddressBar changes with icon effect planning", () => {
    expect(shouldRefreshIconsForConfigChange("showButtonInTheAddressBar")).toBe(true);

    expect(buildIconEffectPlan({
      tabId: 9,
      hasPageAction: true,
      hasAction: true,
      pageActionIconPath: "page-icon",
      actionIconPath: "action-icon",
      showButtonInTheAddressBar: "no",
    })).toEqual([
      {
        type: "reset-page-action",
        tabId: 9,
        forceShow: false,
      },
      {
        type: "set-page-action-icon",
        tabId: 9,
        path: "page-icon",
      },
      {
        type: "hide-page-action",
        tabId: 9,
      },
      {
        type: "set-action-icon",
        tabId: 9,
        path: "action-icon",
      },
    ]);
  });
});