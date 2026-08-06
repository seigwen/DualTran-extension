import { describe, expect, it, vi } from "vitest";
import { resolveTranslateSelectedMenuClick } from "../../src/background/menuClickHelpers.js";
import { buildTranslateSelectedEffectPlan } from "../../src/background/menuExecutionHelpers.js";
import {
  applyPageActionPopupReset,
  executePopupEffects,
} from "../../src/background/popupExecutionHelpers.js";
import { executeTabEffects } from "../../src/background/tabExecutionHelpers.js";

describe("selected-text ui loop integration", () => {
  it("combines selected-text popup fallback with popup open and reset-to-default behavior", () => {
    const setPageActionPopup = vi.fn();
    const opened = [];

    const effects = buildTranslateSelectedEffectPlan(
      resolveTranslateSelectedMenuClick({
        hasPageActionOpenPopup: true,
        hasContentScript: false,
        isInReaderMode: false,
        selectionText: "hello world?",
        tabId: 14,
      }),
      14
    );

    executePopupEffects(effects, {
      setPageActionPopup,
      openPageActionPopup() {
        opened.push("page");
      },
      resetPageAction(tabId, forceShow) {
        applyPageActionPopupReset({
          tabId,
          forceShow,
          translateClickingOnce: "yes",
          useOldPopup: "no",
          setPageActionPopup,
        });
      },
    });

    expect(setPageActionPopup.mock.calls).toEqual([
      [{ popup: "popup/popup-translate-text.html#text=hello%20world%3F", tabId: 14 }],
      [{ popup: null, tabId: 14 }],
    ]);
    expect(opened).toEqual(["page"]);
  });

  it("combines selected-text direct messaging with actual tab message dispatch", () => {
    const sendTabMessage = vi.fn();

    const effects = buildTranslateSelectedEffectPlan(
      resolveTranslateSelectedMenuClick({
        hasPageActionOpenPopup: true,
        hasContentScript: true,
        isInReaderMode: false,
        selectionText: "hello world?",
        tabId: 14,
      }),
      14
    );

    executeTabEffects(effects, {
      sendTabMessage,
    });

    expect(sendTabMessage).toHaveBeenCalledWith(14, {
      action: "TranslateSelectedText",
      selectionText: "hello world?",
    });
  });

  it("keeps reader-mode selected-text on the popup fallback branch even when content script exists", () => {
    const setPageActionPopup = vi.fn();
    const opened = [];

    const effects = buildTranslateSelectedEffectPlan(
      resolveTranslateSelectedMenuClick({
        hasPageActionOpenPopup: true,
        hasContentScript: true,
        isInReaderMode: true,
        selectionText: "reader mode text",
        tabId: 22,
      }),
      22
    );

    executePopupEffects(effects, {
      setPageActionPopup,
      openPageActionPopup() {
        opened.push("page");
      },
      resetPageAction(tabId, forceShow) {
        applyPageActionPopupReset({
          tabId,
          forceShow,
          translateClickingOnce: "yes",
          useOldPopup: "no",
          setPageActionPopup,
        });
      },
    });

    expect(setPageActionPopup.mock.calls).toEqual([
      [{ popup: "popup/popup-translate-text.html#text=reader%20mode%20text", tabId: 22 }],
      [{ popup: null, tabId: 22 }],
    ]);
    expect(opened).toEqual(["page"]);
  });
});