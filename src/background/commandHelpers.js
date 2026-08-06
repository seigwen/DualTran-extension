"use strict";

export function resolveNextPageTranslatorService(currentPageTranslatorService) {
  return currentPageTranslatorService === "google" ? "yandex" : "google";
}

export function resolveHotkeyCommandPlan(command, options = {}) {
  const targetLanguages = Array.isArray(options.targetLanguages) ? options.targetLanguages : [];

  if (command === "hotkey-toggle-translation") {
    return {
      tabQuery: { currentWindow: true, active: true },
      message: { action: "toggle-translation" },
    };
  }

  if (command === "hotkey-translate-selected-text") {
    return {
      tabQuery: { currentWindow: true, active: true },
      message: { action: "TranslateSelectedText" },
    };
  }

  if (command === "hotkey-swap-page-translation-service") {
    return {
      tabQuery: { currentWindow: true, active: true },
      message: { action: "swapTranslationService" },
      nextPageTranslatorService: resolveNextPageTranslatorService(options.currentPageTranslatorService),
    };
  }

  if (command === "hotkey-show-original") {
    return {
      tabQuery: { currentWindow: true, active: true },
      message: {
        action: "translatePage",
        targetLanguage: "original",
      },
    };
  }

  if (/^hotkey-translate-page-[123]$/.test(command)) {
    const index = Number(command.slice(-1)) - 1;
    const targetLanguage = targetLanguages[index];
    if (!targetLanguage) {
      return null;
    }

    return {
      tabQuery: { currentWindow: true, active: true },
      message: {
        action: "translatePage",
        targetLanguage,
      },
      nextTargetLanguage: targetLanguage,
    };
  }

  if (command === "hotkey-hot-translate-selected-text") {
    return {
      tabQuery: { currentWindow: true, active: true },
      message: { action: "hotTranslateSelectedText" },
    };
  }

  return null;
}