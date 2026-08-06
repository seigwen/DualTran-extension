import { describe, expect, it, vi } from "vitest";
import {
  resolveBasicMenuClickAction,
  resolveTranslateSelectedMenuClick,
} from "../../src/background/menuClickHelpers.js";
import {
  buildBasicMenuEffectPlan,
  buildTranslateSelectedEffectPlan,
} from "../../src/background/menuExecutionHelpers.js";
import {
  applyBrowserActionPopupReset,
  applyPageActionPopupReset,
  executePopupEffects,
} from "../../src/background/popupExecutionHelpers.js";

describe("menu popup UI flow integration", () => {
  it("combines browserAction menu clicks with popup reset application and open sequence", () => {
    const browserPopupConfigs = [];
    const opened = [];

    const effects = buildBasicMenuEffectPlan(
      resolveBasicMenuClickAction({
        menuItemId: "browserAction-showPopup",
        tabId: 18,
      })
    );

    executePopupEffects(effects, {
      resetBrowserAction(forceShow) {
        applyBrowserActionPopupReset({
          forceShow,
          translateClickingOnce: "no",
          useOldPopup: "yes",
          setBrowserActionPopup(config) {
            browserPopupConfigs.push(config);
          },
        });
      },
      openBrowserActionPopup() {
        opened.push("browser");
      },
    });

    expect(browserPopupConfigs).toEqual([
      { popup: "popup/old-popup.html" },
      { popup: "popup/old-popup.html" },
    ]);
    expect(opened).toEqual(["browser"]);
  });

  it("combines pageAction menu clicks with popup reset application and open sequence", () => {
    const pagePopupConfigs = [];
    const opened = [];

    const effects = buildBasicMenuEffectPlan(
      resolveBasicMenuClickAction({
        menuItemId: "pageAction-showPopup",
        tabId: 7,
      })
    );

    executePopupEffects(effects, {
      resetPageAction(tabId, forceShow) {
        applyPageActionPopupReset({
          tabId,
          forceShow,
          translateClickingOnce: "no",
          useOldPopup: "no",
          setPageActionPopup(config) {
            pagePopupConfigs.push(config);
          },
        });
      },
      openPageActionPopup() {
        opened.push("page");
      },
    });

    expect(pagePopupConfigs).toEqual([
      { popup: "popup/popup.html", tabId: 7 },
      { popup: "popup/popup.html", tabId: 7 },
    ]);
    expect(opened).toEqual(["page"]);
  });

  it("combines selected-text popup fallback with pageAction popup config and open sequence", () => {
    const setPageActionPopup = vi.fn();
    const opened = [];

    const effects = buildTranslateSelectedEffectPlan(
      resolveTranslateSelectedMenuClick({
        hasPageActionOpenPopup: true,
        hasContentScript: false,
        isInReaderMode: false,
        selectionText: "hello world",
        tabId: 11,
      }),
      11
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
      [{ popup: "popup/popup-translate-text.html#text=hello%20world", tabId: 11 }],
      [{ popup: null, tabId: 11 }],
    ]);
    expect(opened).toEqual(["page"]);
  });
});