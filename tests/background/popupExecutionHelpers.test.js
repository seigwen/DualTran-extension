import { describe, expect, it, vi } from "vitest";
import {
  applyBrowserActionPopupReset,
  applyPageActionPopupReset,
  executeActivePageActionPopupReset,
  executePopupEffects,
} from "../../src/background/popupExecutionHelpers.js";

describe("popupExecutionHelpers", () => {
  it("dispatches browser/page action popup effects in order", () => {
    const resetBrowserAction = vi.fn();
    const openBrowserActionPopup = vi.fn();
    const resetPageAction = vi.fn();
    const setPageActionPopup = vi.fn();
    const openPageActionPopup = vi.fn();

    executePopupEffects([
      { type: "reset-browser-action", forceShow: true },
      { type: "open-browser-action-popup" },
      { type: "reset-page-action", tabId: 12, forceShow: false },
      {
        type: "set-page-action-popup",
        popupConfig: { popup: "popup/popup-translate-text.html", tabId: 12 },
      },
      { type: "open-page-action-popup" },
    ], {
      resetBrowserAction,
      openBrowserActionPopup,
      resetPageAction,
      setPageActionPopup,
      openPageActionPopup,
    });

    expect(resetBrowserAction).toHaveBeenCalledWith(true);
    expect(openBrowserActionPopup).toHaveBeenCalledWith();
    expect(resetPageAction).toHaveBeenCalledWith(12, false);
    expect(setPageActionPopup).toHaveBeenCalledWith({
      popup: "popup/popup-translate-text.html",
      tabId: 12,
    });
    expect(openPageActionPopup).toHaveBeenCalledWith();
  });

  it("ignores unsupported effects and missing handlers", () => {
    expect(() => {
      executePopupEffects([
        { type: "noop" },
        { type: "open-browser-action-popup" },
      ]);
    }).not.toThrow();
  });

  it("builds and applies pageAction popup reset config", () => {
    const setPageActionPopup = vi.fn();

    applyPageActionPopupReset({
      tabId: 7,
      forceShow: true,
      translateClickingOnce: "yes",
      useOldPopup: "no",
      setPageActionPopup,
    });

    expect(setPageActionPopup).toHaveBeenCalledWith({
      popup: "popup/popup.html",
      tabId: 7,
    });
  });

  it("builds and applies browserAction popup reset config", () => {
    const setBrowserActionPopup = vi.fn();

    applyBrowserActionPopupReset({
      forceShow: false,
      translateClickingOnce: "no",
      useOldPopup: "yes",
      setBrowserActionPopup,
    });

    expect(setBrowserActionPopup).toHaveBeenCalledWith({
      popup: "popup/old-popup.html",
    });
  });

  it("queries the active tab before applying a pageAction popup reset", () => {
    const queryTabs = vi.fn((queryInfo, callback) => {
      callback([{ id: 18 }]);
    });
    const setPageActionPopup = vi.fn();

    executeActivePageActionPopupReset({
      translateClickingOnce: "yes",
      useOldPopup: "no",
      queryTabs,
      setPageActionPopup,
    });

    expect(queryTabs).toHaveBeenCalledWith(
      {
        currentWindow: true,
        active: true,
      },
      expect.any(Function)
    );
    expect(setPageActionPopup).toHaveBeenCalledWith({
      popup: null,
      tabId: 18,
    });
  });

  it("skips active pageAction popup reset when the query bridge is missing or empty", () => {
    const setPageActionPopup = vi.fn();

    expect(() => {
      executeActivePageActionPopupReset({
        setPageActionPopup,
      });
      executeActivePageActionPopupReset({
        queryTabs(_queryInfo, callback) {
          callback([]);
        },
        setPageActionPopup,
      });
    }).not.toThrow();

    expect(setPageActionPopup).not.toHaveBeenCalled();
  });
});