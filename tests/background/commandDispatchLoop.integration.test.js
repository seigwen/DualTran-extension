import { describe, expect, it, vi } from "vitest";
import {
  createCommandEffectExecutor,
  executeCommandEffects,
  executeHotkeyCommand,
} from "../../src/background/commandExecutionHelpers.js";
import { createTabEffectExecutor } from "../../src/background/tabExecutionHelpers.js";

describe("command dispatch loop integration", () => {
  it("dispatches service-switch commands through config and tab handlers", () => {
    const setConfig = vi.fn();
    const setTargetLanguage = vi.fn();
    const sendTabMessage = vi.fn();
    const applyTabEffects = createTabEffectExecutor({ sendTabMessage });

    executeHotkeyCommand("hotkey-swap-page-translation-service", {
      currentPageTranslatorService: "google",
      queryTabs(_queryInfo, callback) {
        callback([{ id: 18 }]);
      },
      executeEffects: createCommandEffectExecutor({
        setConfig,
        setTargetLanguage,
        applyTabEffects,
      }),
    });

    expect(setConfig).toHaveBeenCalledWith("pageTranslatorService", "yandex");
    expect(setTargetLanguage).not.toHaveBeenCalled();
    expect(sendTabMessage).toHaveBeenCalledWith(
      18,
      { action: "swapTranslationService" }
    );
  });

  it("dispatches favorite-language commands through target-language and tab handlers", () => {
    const setConfig = vi.fn();
    const setTargetLanguage = vi.fn();
    const sendTabMessage = vi.fn();
    const applyTabEffects = createTabEffectExecutor({ sendTabMessage });

    executeHotkeyCommand("hotkey-translate-page-2", {
      targetLanguages: ["fr", "de", "ja"],
      queryTabs(_queryInfo, callback) {
        callback([{ id: 9 }]);
      },
      executeEffects: createCommandEffectExecutor({
        setConfig,
        setTargetLanguage,
        applyTabEffects,
      }),
    });

    expect(setConfig).not.toHaveBeenCalled();
    expect(setTargetLanguage).toHaveBeenCalledWith("de");
    expect(sendTabMessage).toHaveBeenCalledWith(9, {
      action: "translatePage",
      targetLanguage: "de",
    });
  });
});