import { describe, expect, it, vi } from "vitest";
import {
  resolveActionConfigChange,
  shouldRefreshIconsForConfigChange,
} from "../../src/background/configChangeHelpers.js";
import {
  applyBrowserActionPopupReset,
  executeActivePageActionPopupReset,
} from "../../src/background/popupExecutionHelpers.js";
import {
  buildAllTabIconRefreshPlan,
  buildIconEffectPlan,
} from "../../src/background/iconHelpers.js";
import { executeIconEffects } from "../../src/background/iconExecutionHelpers.js";

describe("config change dispatch loop integration", () => {
  it("dispatches browser and page popup resets for translateClickingOnce changes", () => {
    const setBrowserActionPopup = vi.fn();
    const setPageActionPopup = vi.fn();
    const queryTabs = vi.fn((queryInfo, callback) => {
      callback([{ id: 18 }]);
    });

    expect(resolveActionConfigChange("translateClickingOnce")).toEqual({
      resetBrowserAction: true,
      resetActivePageAction: true,
    });

    applyBrowserActionPopupReset({
      forceShow: false,
      translateClickingOnce: "yes",
      useOldPopup: "no",
      setBrowserActionPopup,
    });
    executeActivePageActionPopupReset({
      translateClickingOnce: "yes",
      useOldPopup: "no",
      queryTabs,
      setPageActionPopup,
    });

    expect(setBrowserActionPopup).toHaveBeenCalledWith({ popup: null });
    expect(setPageActionPopup).toHaveBeenCalledWith({ popup: null, tabId: 18 });
  });

  it("dispatches icon refresh effects for address-bar visibility changes across refresh-targeted tabs", () => {
    const resetPageAction = vi.fn();
    const setPageActionIcon = vi.fn();
    const hidePageAction = vi.fn();
    const showPageAction = vi.fn();
    const setActionIcon = vi.fn();

    expect(shouldRefreshIconsForConfigChange("showButtonInTheAddressBar")).toBe(true);

    const refreshTabIds = buildAllTabIconRefreshPlan([{ id: 3 }, { id: 18 }, { url: "https://example.com" }]);
    const effects = refreshTabIds.flatMap((tabId) => buildIconEffectPlan({
      tabId,
      hasPageAction: true,
      hasAction: true,
      pageActionIconPath: `page-icon-${tabId}`,
      actionIconPath: `action-icon-${tabId}`,
      showButtonInTheAddressBar: "no",
    }));

    executeIconEffects(effects, {
      resetPageAction,
      setPageActionIcon,
      hidePageAction,
      showPageAction,
      setActionIcon,
    });

    expect(resetPageAction.mock.calls).toEqual([
      [3, false],
      [18, false],
    ]);
    expect(setPageActionIcon.mock.calls).toEqual([
      [{ tabId: 3, path: "page-icon-3" }],
      [{ tabId: 18, path: "page-icon-18" }],
    ]);
    expect(hidePageAction.mock.calls).toEqual([[3], [18]]);
    expect(showPageAction).not.toHaveBeenCalled();
    expect(setActionIcon.mock.calls).toEqual([
      [{ tabId: 3, path: "action-icon-3" }],
      [{ tabId: 18, path: "action-icon-18" }],
    ]);
  });
});