import { describe, expect, it, vi } from "vitest";
import {
  resolveTranslateSelectedMenuClickFromStorage,
} from "../../src/background/menuClickHelpers.js";
import {
  createMenuEffectExecutor,
  executePdfMenuFromStorage,
  executeTranslateSelectedFromStorage,
} from "../../src/background/menuExecutionHelpers.js";
import { executePopupEffects } from "../../src/background/popupExecutionHelpers.js";
import { executeTabEffects } from "../../src/background/tabExecutionHelpers.js";

describe("menu storage-backed dispatch loop integration", () => {
  it("dispatches selected-text popup fallback from stored content-script absence", () => {
    const setPageActionPopup = vi.fn();
    const openPageActionPopup = vi.fn();
    const resetPageAction = vi.fn();
    const applyEffects = createMenuEffectExecutor({
      applyPopupEffects(effects) {
        executePopupEffects(effects, {
          setPageActionPopup,
          openPageActionPopup,
          resetPageAction,
        });
      },
    });

    return executeTranslateSelectedFromStorage({
      tabId: 14,
      selectionText: "hello world",
      hasPageActionOpenPopup: true,
      isInReaderMode: false,
      getStorage: vi.fn(async () => ({
        tabHasContentScript: {
          14: false,
        },
      })),
      applyEffects,
    }).then(() => {
      expect(setPageActionPopup).toHaveBeenCalledWith({
        popup: "popup/popup-translate-text.html#text=hello%20world",
        tabId: 14,
      });
      expect(openPageActionPopup).toHaveBeenCalledWith();
      expect(resetPageAction).toHaveBeenCalledWith(14, false);
    });
  });

  it("dispatches PDF fallback website open from stored mimeType", () => {
    const createTab = vi.fn();
    const applyEffects = createMenuEffectExecutor({
      applyTabEffects(effects) {
        executeTabEffects(effects, {
          createTab,
        });
      },
    });

    return executePdfMenuFromStorage({
      tabId: 11,
      canOpenPopup: true,
      popupTarget: "browserAction",
      websiteUrl: "https://translatewebpages.org/",
      getStorage: vi.fn(async () => ({
        tabToMimeType: {
          11: "text/html",
        },
      })),
      applyEffects,
    }).then(() => {
      expect(createTab).toHaveBeenCalledWith({
        url: "https://translatewebpages.org/",
      });
    });
  });
});