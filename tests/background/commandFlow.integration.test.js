import { describe, expect, it, vi } from "vitest";
import { resolveHotkeyCommandPlan } from "../../src/background/commandHelpers.js";
import { buildHotkeyEffectPlan } from "../../src/background/commandExecutionHelpers.js";
import { executeTabEffects } from "../../src/background/tabExecutionHelpers.js";

describe("command flow integration", () => {
  it("dispatches selected-text hotkeys through the shared tab execution path", () => {
    const sendTabMessage = vi.fn();

    const selectedTextEffects = buildHotkeyEffectPlan(
      resolveHotkeyCommandPlan("hotkey-translate-selected-text"),
      [{ id: 18 }]
    );
    const hotSelectedTextEffects = buildHotkeyEffectPlan(
      resolveHotkeyCommandPlan("hotkey-hot-translate-selected-text"),
      [{ id: 18 }]
    );

    executeTabEffects(selectedTextEffects, { sendTabMessage });
    executeTabEffects(hotSelectedTextEffects, { sendTabMessage });

    expect(sendTabMessage.mock.calls).toEqual([
      [18, { action: "TranslateSelectedText" }],
      [18, { action: "hotTranslateSelectedText" }],
    ]);
  });

  it("combines swap-page-service command planning with config update and tab message effects", () => {
    const plan = resolveHotkeyCommandPlan("hotkey-swap-page-translation-service", {
      currentPageTranslatorService: "google",
    });

    expect(buildHotkeyEffectPlan(plan, [{ id: 18 }])).toEqual([
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

  it("combines favorite-language command planning with target-language update and translate-page effects", () => {
    const plan = resolveHotkeyCommandPlan("hotkey-translate-page-2", {
      targetLanguages: ["fr", "de", "ja"],
    });

    expect(buildHotkeyEffectPlan(plan, [{ id: 9 }])).toEqual([
      {
        type: "set-target-language",
        value: "de",
      },
      {
        type: "send-tab-message",
        tabId: 9,
        message: {
          action: "translatePage",
          targetLanguage: "de",
        },
      },
    ]);
  });

  it("dispatches toggle and show-original commands through executable tab effects", () => {
    const sendTabMessage = vi.fn();

    const toggleEffects = buildHotkeyEffectPlan(
      resolveHotkeyCommandPlan("hotkey-toggle-translation"),
      [{ id: 9 }]
    );
    const showOriginalEffects = buildHotkeyEffectPlan(
      resolveHotkeyCommandPlan("hotkey-show-original"),
      [{ id: 9 }]
    );

    executeTabEffects(toggleEffects, { sendTabMessage });
    executeTabEffects(showOriginalEffects, { sendTabMessage });

    expect(sendTabMessage.mock.calls).toEqual([
      [9, { action: "toggle-translation" }],
      [
        9,
        {
          action: "translatePage",
          targetLanguage: "original",
        },
      ],
    ]);
  });
});