import { describe, expect, it, vi } from "vitest";
import {
  buildHotkeyEffectPlan,
  createCommandEffectExecutor,
  executeCommandEffects,
  executeHotkeyCommand,
} from "../../src/background/commandExecutionHelpers.js";

describe("commandExecutionHelpers", () => {
  it("maps a basic hotkey plan into a single tab message effect", () => {
    expect(buildHotkeyEffectPlan({
      tabQuery: { currentWindow: true, active: true },
      message: { action: "toggle-translation" },
    }, [{ id: 18 }])).toEqual([
      {
        type: "send-tab-message",
        tabId: 18,
        message: { action: "toggle-translation" },
      },
    ]);
  });

  it("prepends page-translator-service updates before dispatching the tab message", () => {
    expect(buildHotkeyEffectPlan({
      tabQuery: { currentWindow: true, active: true },
      message: { action: "swapTranslationService" },
      nextPageTranslatorService: "yandex",
    }, [{ id: 18 }])).toEqual([
      {
        type: "set-config",
        key: "pageTranslatorService",
        value: "yandex",
      },
      {
        type: "send-tab-message",
        tabId: 18,
        message: { action: "swapTranslationService" },
      },
    ]);
  });

  it("prepends target-language updates before dispatching the tab message", () => {
    expect(buildHotkeyEffectPlan({
      tabQuery: { currentWindow: true, active: true },
      message: {
        action: "translatePage",
        targetLanguage: "de",
      },
      nextTargetLanguage: "de",
    }, [{ id: 18 }])).toEqual([
      {
        type: "set-target-language",
        value: "de",
      },
      {
        type: "send-tab-message",
        tabId: 18,
        message: {
          action: "translatePage",
          targetLanguage: "de",
        },
      },
    ]);
  });

  it("keeps both config updates when a plan changes service and target language together", () => {
    expect(buildHotkeyEffectPlan({
      tabQuery: { currentWindow: true, active: true },
      message: {
        action: "translatePage",
        targetLanguage: "fr",
      },
      nextPageTranslatorService: "google",
      nextTargetLanguage: "fr",
    }, [{ id: 9 }])).toEqual([
      {
        type: "set-config",
        key: "pageTranslatorService",
        value: "google",
      },
      {
        type: "set-target-language",
        value: "fr",
      },
      {
        type: "send-tab-message",
        tabId: 9,
        message: {
          action: "translatePage",
          targetLanguage: "fr",
        },
      },
    ]);
  });

  it("returns no effects when the plan is missing and skips messaging when no tab is available", () => {
    expect(buildHotkeyEffectPlan(null, [{ id: 18 }])).toEqual([]);
    expect(buildHotkeyEffectPlan({
      tabQuery: { currentWindow: true, active: true },
      message: { action: "toggle-translation" },
    }, [])).toEqual([]);
  });

  it("executes config, target-language, and tab effects through the shared command executor", () => {
    const setConfig = vi.fn();
    const setTargetLanguage = vi.fn();
    const executeTabEffect = vi.fn();

    executeCommandEffects([
      {
        type: "set-config",
        key: "pageTranslatorService",
        value: "yandex",
      },
      {
        type: "set-target-language",
        value: "de",
      },
      {
        type: "send-tab-message",
        tabId: 18,
        message: { action: "translatePage", targetLanguage: "de" },
      },
    ], {
      setConfig,
      setTargetLanguage,
      executeTabEffect,
    });

    expect(setConfig).toHaveBeenCalledWith("pageTranslatorService", "yandex");
    expect(setTargetLanguage).toHaveBeenCalledWith("de");
    expect(executeTabEffect).toHaveBeenCalledWith({
      type: "send-tab-message",
      tabId: 18,
      message: { action: "translatePage", targetLanguage: "de" },
    });
  });

  it("creates a command effect executor that routes config, target-language, and tab effects", () => {
    const setConfig = vi.fn();
    const setTargetLanguage = vi.fn();
    const applyTabEffects = vi.fn();

    const executeEffects = createCommandEffectExecutor({
      setConfig,
      setTargetLanguage,
      applyTabEffects,
    });

    executeEffects([
      {
        type: "set-config",
        key: "pageTranslatorService",
        value: "yandex",
      },
      {
        type: "set-target-language",
        value: "de",
      },
      {
        type: "send-tab-message",
        tabId: 18,
        message: { action: "translatePage", targetLanguage: "de" },
      },
    ]);

    expect(setConfig).toHaveBeenCalledWith("pageTranslatorService", "yandex");
    expect(setTargetLanguage).toHaveBeenCalledWith("de");
    expect(applyTabEffects).toHaveBeenCalledWith([
      {
        type: "send-tab-message",
        tabId: 18,
        message: { action: "translatePage", targetLanguage: "de" },
      },
    ]);
  });

  it("queries the active tab before dispatching hotkey effects", () => {
    const queryTabs = vi.fn((queryInfo, callback) => {
      callback([{ id: 18 }]);
    });
    const executeEffects = vi.fn();

    expect(
      executeHotkeyCommand("hotkey-swap-page-translation-service", {
        currentPageTranslatorService: "google",
        queryTabs,
        executeEffects,
      })
    ).toEqual({
      tabQuery: { currentWindow: true, active: true },
      message: { action: "swapTranslationService" },
      nextPageTranslatorService: "yandex",
    });

    expect(queryTabs).toHaveBeenCalledWith(
      { currentWindow: true, active: true },
      expect.any(Function)
    );
    expect(executeEffects).toHaveBeenCalledWith([
      {
        type: "set-config",
        key: "pageTranslatorService",
        value: "yandex",
      },
      {
        type: "send-tab-message",
        tabId: 18,
        message: { action: "swapTranslationService" },
      },
    ]);
  });

  it("returns null when the hotkey plan is missing or tab querying is unavailable", () => {
    expect(executeHotkeyCommand("unknown-hotkey", {
      queryTabs: vi.fn(),
      executeEffects: vi.fn(),
    })).toBeNull();

    expect(executeHotkeyCommand("hotkey-toggle-translation", {
      executeEffects: vi.fn(),
    })).toBeNull();
  });
});