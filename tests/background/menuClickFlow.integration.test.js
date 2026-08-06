import { describe, expect, it } from "vitest";
import {
  resolveBasicMenuClickAction,
  resolvePdfMenuExecutionFromStorage,
  resolveTranslateSelectedMenuClick,
} from "../../src/background/menuClickHelpers.js";
import {
  buildBasicMenuEffectPlan,
  buildPdfMenuEffectPlan,
  buildTranslateSelectedEffectPlan,
} from "../../src/background/menuExecutionHelpers.js";

describe("menu click flow integration", () => {
  it("combines basic menu click decisions with executable effects", () => {
    expect(buildBasicMenuEffectPlan(
      resolveBasicMenuClickAction({
        menuItemId: "translate-web-page",
        tabId: 18,
      })
    )).toEqual([
      {
        type: "send-tab-message",
        tabId: 18,
        message: {
          action: "toggle-translation",
        },
      },
    ]);

    expect(buildBasicMenuEffectPlan(
      resolveBasicMenuClickAction({
        menuItemId: "browserAction-showPopup",
        tabId: 18,
      })
    )).toEqual([
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

    expect(buildBasicMenuEffectPlan(
      resolveBasicMenuClickAction({
        menuItemId: "pageAction-showPopup",
        tabId: 18,
      })
    )).toEqual([
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

  it("combines never-translate and more-options decisions with executable effects", () => {
    expect(buildBasicMenuEffectPlan(
      resolveBasicMenuClickAction({
        menuItemId: "never-translate",
        tabId: 9,
        tabUrl: "https://docs.dualtran.example/page?id=1",
      })
    )).toEqual([
      {
        type: "add-never-translate-site",
        hostname: "docs.dualtran.example",
      },
    ]);

    expect(buildBasicMenuEffectPlan(
      resolveBasicMenuClickAction({
        menuItemId: "more-options",
        tabId: 9,
        optionsPageUrl: "chrome-extension://id/options/options.html",
      })
    )).toEqual([
      {
        type: "open-tab",
        url: "chrome-extension://id/options/options.html",
      },
    ]);
  });

  it("combines selected-text and pdf menu decisions with popup or fallback effects", () => {
    expect(buildTranslateSelectedEffectPlan(
      resolveTranslateSelectedMenuClick({
        hasPageActionOpenPopup: true,
        hasContentScript: false,
        isInReaderMode: false,
        selectionText: "hello world",
        tabId: 7,
      }),
      7
    )).toEqual([
      {
        type: "set-page-action-popup",
        popupConfig: {
          popup: "popup/popup-translate-text.html#text=hello%20world",
          tabId: 7,
        },
      },
      {
        type: "open-page-action-popup",
      },
      {
        type: "reset-page-action",
        tabId: 7,
        forceShow: false,
      },
    ]);

    expect(buildPdfMenuEffectPlan(
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
    )).toEqual([
      {
        type: "open-page-action-popup",
      },
    ]);
  });

  it("combines selected-text direct messaging and pdf fallback branches with executable effects", () => {
    expect(buildTranslateSelectedEffectPlan(
      resolveTranslateSelectedMenuClick({
        hasPageActionOpenPopup: true,
        hasContentScript: true,
        isInReaderMode: false,
        selectionText: "hello world",
        tabId: 7,
      }),
      7
    )).toEqual([
      {
        type: "send-tab-message",
        tabId: 7,
        message: {
          action: "TranslateSelectedText",
          selectionText: "hello world",
        },
      },
    ]);

    expect(buildPdfMenuEffectPlan(
      resolvePdfMenuExecutionFromStorage({
        storageResult: {
          tabToMimeType: {
            11: "text/html",
          },
        },
        tabId: 11,
        canOpenPopup: true,
        popupTarget: "browserAction",
        websiteUrl: "https://translatewebpages.org/",
      })
    )).toEqual([
      {
        type: "open-tab",
        url: "https://translatewebpages.org/",
      },
    ]);

    expect(buildPdfMenuEffectPlan(
      resolvePdfMenuExecutionFromStorage({
        storageResult: {
          tabToMimeType: {},
        },
        tabId: 11,
        canOpenPopup: true,
        popupTarget: "browserAction",
      })
    )).toEqual([
      {
        type: "log-error",
        message: "error:result.tabToMimeType[tab.id] is undefined",
      },
    ]);
  });
});