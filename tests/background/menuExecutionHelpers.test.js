import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  buildBasicMenuEffectPlan,
  buildPdfMenuEffectPlan,
  buildTranslateSelectedEffectPlan,
  createMenuEffectExecutor,
  executeMenuEffects,
  executePdfMenuFromStorage,
  executeTranslateSelectedFromStorage,
  MISSING_PDF_MIME_TYPE_ERROR,
} from "../../src/background/menuExecutionHelpers.js";

describe("menuExecutionHelpers", () => {
  it("keeps popup-sequence effect ordering intact for basic menu actions", () => {
    expect(buildBasicMenuEffectPlan({
      type: "run-popup-sequence",
      steps: [
        { type: "reset-browser-action", forceShow: true },
        { type: "open-browser-action-popup" },
        { type: "reset-browser-action", forceShow: false },
      ],
    })).toEqual([
      { type: "reset-browser-action", forceShow: true },
      { type: "open-browser-action-popup" },
      { type: "reset-browser-action", forceShow: false },
    ]);
  });

  it("maps basic send-message, add-site, and open-tab actions into executable effects", () => {
    expect(buildBasicMenuEffectPlan({
      type: "send-tab-message",
      tabId: 9,
      message: { action: "toggle-translation" },
    })).toEqual([
      {
        type: "send-tab-message",
        tabId: 9,
        message: { action: "toggle-translation" },
      },
    ]);

    expect(buildBasicMenuEffectPlan({
      type: "add-never-translate-site",
      hostname: "docs.example.com",
    })).toEqual([
      {
        type: "add-never-translate-site",
        hostname: "docs.example.com",
      },
    ]);

    expect(buildBasicMenuEffectPlan({
      type: "open-tab",
      url: "chrome-extension://abc/options/options.html",
    })).toEqual([
      {
        type: "open-tab",
        url: "chrome-extension://abc/options/options.html",
      },
    ]);
  });

  it("builds the translate-selected popup fallback sequence with reset after opening", () => {
    expect(buildTranslateSelectedEffectPlan({
      type: "open-page-action-popup",
      popupConfig: {
        popup: "popup/popup-translate-text.html#text=hello",
        tabId: 7,
      },
    }, 7)).toEqual([
      {
        type: "set-page-action-popup",
        popupConfig: {
          popup: "popup/popup-translate-text.html#text=hello",
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
  });

  it("maps translate-selected content-script fallback into a send-tab-message effect", () => {
    expect(buildTranslateSelectedEffectPlan({
      type: "send-message",
      message: {
        action: "TranslateSelectedText",
        selectionText: "hello world",
      },
    }, 12)).toEqual([
      {
        type: "send-tab-message",
        tabId: 12,
        message: {
          action: "TranslateSelectedText",
          selectionText: "hello world",
        },
      },
    ]);
  });

  it("maps PDF popup, website fallback, and missing mime-type branches into effects", () => {
    expect(buildPdfMenuEffectPlan({
      type: "open-popup",
      popupTarget: "browserAction",
    })).toEqual([
      { type: "open-browser-action-popup" },
    ]);

    expect(buildPdfMenuEffectPlan({
      type: "open-popup",
      popupTarget: "pageAction",
    })).toEqual([
      { type: "open-page-action-popup" },
    ]);

    expect(buildPdfMenuEffectPlan({
      type: "open-tab",
      url: "https://translatewebpages.org/",
    })).toEqual([
      {
        type: "open-tab",
        url: "https://translatewebpages.org/",
      },
    ]);

    expect(buildPdfMenuEffectPlan({
      type: "missing-mime-type",
    })).toEqual([
      {
        type: "log-error",
        message: MISSING_PDF_MIME_TYPE_ERROR,
      },
    ]);
  });

  it("returns empty effect plans for noop or unknown branches", () => {
    expect(buildBasicMenuEffectPlan(null)).toEqual([]);
    expect(buildTranslateSelectedEffectPlan(null, 1)).toEqual([]);
    expect(buildPdfMenuEffectPlan({ type: "noop" })).toEqual([]);
  });

  it("loads stored content-script state before dispatching selected-text menu effects", async () => {
    const getStorage = vi.fn(async () => ({
      tabHasContentScript: {
        14: false,
      },
    }));
    const applyEffects = vi.fn();

    await expect(
      executeTranslateSelectedFromStorage({
        tabId: 14,
        selectionText: "hello world",
        hasPageActionOpenPopup: true,
        isInReaderMode: false,
        getStorage,
        applyEffects,
      })
    ).resolves.toEqual({
      type: "open-page-action-popup",
      popupConfig: {
        popup: "popup/popup-translate-text.html#text=hello%20world",
        tabId: 14,
      },
    });

    expect(getStorage).toHaveBeenCalledWith(["tabHasContentScript"]);
    expect(applyEffects).toHaveBeenCalledWith([
      {
        type: "set-page-action-popup",
        popupConfig: {
          popup: "popup/popup-translate-text.html#text=hello%20world",
          tabId: 14,
        },
      },
      {
        type: "open-page-action-popup",
      },
      {
        type: "reset-page-action",
        tabId: 14,
        forceShow: false,
      },
    ]);
  });

  it("loads stored mimeType before dispatching PDF menu effects", async () => {
    const getStorage = vi.fn(async () => ({
      tabToMimeType: {
        11: "application/pdf",
      },
    }));
    const applyEffects = vi.fn();

    await expect(
      executePdfMenuFromStorage({
        tabId: 11,
        canOpenPopup: true,
        popupTarget: "browserAction",
        getStorage,
        applyEffects,
      })
    ).resolves.toEqual({
      type: "open-popup",
      popupTarget: "browserAction",
    });

    expect(getStorage).toHaveBeenCalledWith(["tabToMimeType"]);
    expect(applyEffects).toHaveBeenCalledWith([
      { type: "open-browser-action-popup" },
    ]);
  });

  it("returns null when PDF storage dispatch cannot be evaluated", async () => {
    await expect(executePdfMenuFromStorage({
      getStorage: vi.fn(),
      applyEffects: vi.fn(),
    })).resolves.toBeNull();

    await expect(executeTranslateSelectedFromStorage({
      getStorage: vi.fn(),
      applyEffects: vi.fn(),
    })).resolves.toBeNull();
  });

  it("dispatches menu effects through site/log/popup/tab handlers", () => {
    const addNeverTranslateSite = vi.fn();
    const logError = vi.fn();
    const applyPopupEffects = vi.fn();
    const applyTabEffects = vi.fn();

    executeMenuEffects([
      { type: "add-never-translate-site", hostname: "docs.example.com" },
      { type: "log-error", message: "broken" },
      { type: "open-tab", url: "https://translatewebpages.org/" },
    ], {
      addNeverTranslateSite,
      logError,
      applyPopupEffects,
      applyTabEffects,
    });

    expect(addNeverTranslateSite).toHaveBeenCalledWith("docs.example.com");
    expect(logError).toHaveBeenCalledWith("broken");
    expect(applyPopupEffects).toHaveBeenCalledWith([
      { type: "open-tab", url: "https://translatewebpages.org/" },
    ]);
    expect(applyTabEffects).toHaveBeenCalledWith([
      { type: "open-tab", url: "https://translatewebpages.org/" },
    ]);

    expect(() => executeMenuEffects()).not.toThrow();
  });

  it("creates a menu effect executor that routes site/log/popup/tab effects", () => {
    const addNeverTranslateSite = vi.fn();
    const logError = vi.fn();
    const applyPopupEffects = vi.fn();
    const applyTabEffects = vi.fn();

    const executeEffects = createMenuEffectExecutor({
      addNeverTranslateSite,
      logError,
      applyPopupEffects,
      applyTabEffects,
    });

    executeEffects([
      { type: "add-never-translate-site", hostname: "docs.example.com" },
      { type: "log-error", message: "broken" },
      { type: "open-tab", url: "https://translatewebpages.org/" },
    ]);

    expect(addNeverTranslateSite).toHaveBeenCalledWith("docs.example.com");
    expect(logError).toHaveBeenCalledWith("broken");
    expect(applyPopupEffects).toHaveBeenCalledWith([
      { type: "open-tab", url: "https://translatewebpages.org/" },
    ]);
    expect(applyTabEffects).toHaveBeenCalledWith([
      { type: "open-tab", url: "https://translatewebpages.org/" },
    ]);
  });
});