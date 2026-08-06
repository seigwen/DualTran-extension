import { describe, expect, it } from "vitest";
import {
  resolveHotkeyCommandPlan,
  resolveNextPageTranslatorService,
} from "../../src/background/commandHelpers.js";

describe("commandHelpers", () => {
  it("toggles page translation service between google and yandex", () => {
    expect(resolveNextPageTranslatorService("google")).toBe("yandex");
    expect(resolveNextPageTranslatorService("yandex")).toBe("google");
    expect(resolveNextPageTranslatorService(undefined)).toBe("google");
  });

  it("builds message plans for basic toggle and selected-text hotkeys", () => {
    expect(resolveHotkeyCommandPlan("hotkey-toggle-translation")).toEqual({
      tabQuery: { currentWindow: true, active: true },
      message: { action: "toggle-translation" },
    });

    expect(resolveHotkeyCommandPlan("hotkey-translate-selected-text")).toEqual({
      tabQuery: { currentWindow: true, active: true },
      message: { action: "TranslateSelectedText" },
    });

    expect(resolveHotkeyCommandPlan("hotkey-hot-translate-selected-text")).toEqual({
      tabQuery: { currentWindow: true, active: true },
      message: { action: "hotTranslateSelectedText" },
    });
  });

  it("builds the swap-page-service hotkey plan with the next service", () => {
    expect(
      resolveHotkeyCommandPlan("hotkey-swap-page-translation-service", {
        currentPageTranslatorService: "google",
      })
    ).toEqual({
      tabQuery: { currentWindow: true, active: true },
      message: { action: "swapTranslationService" },
      nextPageTranslatorService: "yandex",
    });
  });

  it("builds page translation plans for show-original and favorite target languages", () => {
    expect(resolveHotkeyCommandPlan("hotkey-show-original")).toEqual({
      tabQuery: { currentWindow: true, active: true },
      message: {
        action: "translatePage",
        targetLanguage: "original",
      },
    });

    expect(
      resolveHotkeyCommandPlan("hotkey-translate-page-2", {
        targetLanguages: ["fr", "de", "ja"],
      })
    ).toEqual({
      tabQuery: { currentWindow: true, active: true },
      message: {
        action: "translatePage",
        targetLanguage: "de",
      },
      nextTargetLanguage: "de",
    });
  });

  it("returns null when a favorite target language slot is missing or the command is unknown", () => {
    expect(
      resolveHotkeyCommandPlan("hotkey-translate-page-3", {
        targetLanguages: ["fr", "de"],
      })
    ).toBeNull();

    expect(resolveHotkeyCommandPlan("unknown-command")).toBeNull();
  });
});