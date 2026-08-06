import { describe, expect, it } from "vitest";
import {
  buildPopupMenuExecution,
  buildTranslateSelectedPopupConfig,
  resolveBasicMenuClickAction,
  resolvePdfMenuAction,
  resolvePdfMenuExecution,
  resolvePdfMenuExecutionFromStorage,
  resolveTranslateSelectedMenuClick,
  resolveTranslateSelectedMenuClickFromStorage,
  shouldOpenPageActionPopupForSelection,
} from "../../src/background/menuClickHelpers.js";

describe("menuClickHelpers", () => {
  it("resolves translate-web-page clicks to a toggle message for the active tab", () => {
    expect(
      resolveBasicMenuClickAction({
        menuItemId: "translate-web-page",
        tabId: 18,
      })
    ).toEqual({
      type: "send-tab-message",
      tabId: 18,
      message: {
        action: "toggle-translation",
      },
    });
  });

  it("resolves popup menu clicks to browser or page action popup plans", () => {
    expect(
      resolveBasicMenuClickAction({
        menuItemId: "browserAction-showPopup",
        tabId: 18,
      })
    ).toEqual({
      type: "run-popup-sequence",
      steps: [
        {
          type: "reset-browser-action",
          forceShow: true,
        },
        {
          type: "open-browser-action-popup",
        },
        {
          type: "reset-browser-action",
          forceShow: false,
        },
      ],
    });
    expect(
      resolveBasicMenuClickAction({
        menuItemId: "pageAction-showPopup",
        tabId: 18,
      })
    ).toEqual({
      type: "run-popup-sequence",
      steps: [
        {
          type: "reset-page-action",
          tabId: 18,
          forceShow: true,
        },
        {
          type: "open-page-action-popup",
        },
        {
          type: "reset-page-action",
          tabId: 18,
          forceShow: false,
        },
      ],
    });
  });

  it("builds popup execution sequences with reset and open ordering intact", () => {
    expect(buildPopupMenuExecution({ menuItemId: "browserAction-showPopup" })).toEqual([
      {
        type: "reset-browser-action",
        forceShow: true,
      },
      {
        type: "open-browser-action-popup",
      },
      {
        type: "reset-browser-action",
        forceShow: false,
      },
    ]);
    expect(buildPopupMenuExecution({ menuItemId: "pageAction-showPopup", tabId: 18 })).toEqual([
      {
        type: "reset-page-action",
        tabId: 18,
        forceShow: true,
      },
      {
        type: "open-page-action-popup",
      },
      {
        type: "reset-page-action",
        tabId: 18,
        forceShow: false,
      },
    ]);
  });

  it("resolves never-translate and more-options clicks to hostname and tab-open actions", () => {
    expect(
      resolveBasicMenuClickAction({
        menuItemId: "never-translate",
        tabUrl: "https://docs.example.com/path?q=1",
      })
    ).toEqual({
      type: "add-never-translate-site",
      hostname: "docs.example.com",
    });
    expect(
      resolveBasicMenuClickAction({
        menuItemId: "more-options",
        optionsPageUrl: "chrome-extension://abc/options/options.html",
      })
    ).toEqual({
      type: "open-tab",
      url: "chrome-extension://abc/options/options.html",
    });
  });

  it("opens the pageAction popup when firefox popup support exists and content script is unavailable", () => {
    expect(
      shouldOpenPageActionPopupForSelection({
        hasPageActionOpenPopup: true,
        hasContentScript: false,
        isInReaderMode: false,
      })
    ).toBe(true);
  });

  it("also opens the pageAction popup in reader mode even when content script exists", () => {
    expect(
      shouldOpenPageActionPopupForSelection({
        hasPageActionOpenPopup: true,
        hasContentScript: true,
        isInReaderMode: true,
      })
    ).toBe(true);
  });

  it("falls back to content-script messaging when popup support is absent or content script is ready", () => {
    expect(
      shouldOpenPageActionPopupForSelection({
        hasPageActionOpenPopup: false,
        hasContentScript: false,
        isInReaderMode: false,
      })
    ).toBe(false);
    expect(
      shouldOpenPageActionPopupForSelection({
        hasPageActionOpenPopup: true,
        hasContentScript: true,
        isInReaderMode: false,
      })
    ).toBe(false);
  });

  it("builds the translate-selected popup config with encoded text", () => {
    expect(buildTranslateSelectedPopupConfig("hello world?", 7)).toEqual({
      popup: "popup/popup-translate-text.html#text=hello%20world%3F",
      tabId: 7,
    });
  });

  it("resolves selected-text clicks to a pageAction popup when popup fallback is needed", () => {
    expect(
      resolveTranslateSelectedMenuClick({
        hasPageActionOpenPopup: true,
        hasContentScript: false,
        isInReaderMode: false,
        selectionText: "hello world?",
        tabId: 7,
      })
    ).toEqual({
      type: "open-page-action-popup",
      popupConfig: {
        popup: "popup/popup-translate-text.html#text=hello%20world%3F",
        tabId: 7,
      },
    });
  });

  it("resolves selected-text clicks to content-script messaging when popup fallback is unnecessary", () => {
    expect(
      resolveTranslateSelectedMenuClick({
        hasPageActionOpenPopup: true,
        hasContentScript: true,
        isInReaderMode: false,
        selectionText: "hello world?",
        tabId: 7,
      })
    ).toEqual({
      type: "send-message",
      message: {
        action: "TranslateSelectedText",
        selectionText: "hello world?",
      },
    });
  });

  it("resolves selected-text clicks directly from storage-backed content-script state", () => {
    expect(
      resolveTranslateSelectedMenuClickFromStorage({
        storageResult: {
          tabHasContentScript: {
            7: false,
          },
        },
        hasPageActionOpenPopup: true,
        isInReaderMode: false,
        selectionText: "hello world?",
        tabId: 7,
      })
    ).toEqual({
      type: "open-page-action-popup",
      popupConfig: {
        popup: "popup/popup-translate-text.html#text=hello%20world%3F",
        tabId: 7,
      },
    });

    expect(
      resolveTranslateSelectedMenuClickFromStorage({
        storageResult: {
          tabHasContentScript: {
            7: true,
          },
        },
        hasPageActionOpenPopup: true,
        isInReaderMode: false,
        selectionText: "hello world?",
        tabId: 7,
      })
    ).toEqual({
      type: "send-message",
      message: {
        action: "TranslateSelectedText",
        selectionText: "hello world?",
      },
    });
  });

  it("resolves PDF menu actions for popup, website fallback, and missing mimeType", () => {
    expect(resolvePdfMenuAction({ mimeType: "application/pdf", canOpenPopup: true })).toBe("open-popup");
    expect(resolvePdfMenuAction({ mimeType: "text/html", canOpenPopup: true })).toBe("open-website");
    expect(resolvePdfMenuAction({ mimeType: "application/pdf", canOpenPopup: false })).toBe("open-website");
    expect(resolvePdfMenuAction({ mimeType: undefined, canOpenPopup: true })).toBe("noop");
  });

  it("resolves PDF menu execution plans for popup, website fallback, and noop", () => {
    expect(
      resolvePdfMenuExecution({
        mimeType: "application/pdf",
        canOpenPopup: true,
        popupTarget: "browserAction",
      })
    ).toEqual({
      type: "open-popup",
      popupTarget: "browserAction",
    });
    expect(
      resolvePdfMenuExecution({
        mimeType: "text/html",
        canOpenPopup: true,
        popupTarget: "pageAction",
      })
    ).toEqual({
      type: "open-tab",
      url: "https://translatewebpages.org/",
    });
    expect(
      resolvePdfMenuExecution({
        mimeType: undefined,
        canOpenPopup: true,
        popupTarget: "pageAction",
      })
    ).toEqual({
      type: "noop",
    });
  });

  it("resolves PDF menu execution directly from storage results", () => {
    expect(
      resolvePdfMenuExecutionFromStorage({
        storageResult: {
          tabToMimeType: {
            18: "application/pdf",
          },
        },
        tabId: 18,
        canOpenPopup: true,
        popupTarget: "pageAction",
      })
    ).toEqual({
      type: "open-popup",
      popupTarget: "pageAction",
    });
    expect(
      resolvePdfMenuExecutionFromStorage({
        storageResult: {
          tabToMimeType: {
            18: "text/html",
          },
        },
        tabId: 18,
        canOpenPopup: true,
        popupTarget: "browserAction",
      })
    ).toEqual({
      type: "open-tab",
      url: "https://translatewebpages.org/",
    });
  });

  it("reports missing PDF mime types from storage results", () => {
    expect(
      resolvePdfMenuExecutionFromStorage({
        storageResult: {},
        tabId: 18,
        canOpenPopup: true,
        popupTarget: "browserAction",
      })
    ).toEqual({
      type: "missing-mime-type",
    });
  });
});