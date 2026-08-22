"use strict";

export function getMessageWithFallback(key, fallback, substitutions) {
  try {
    const message = chrome?.i18n?.getMessage?.(key, substitutions);
    if (typeof message === "string" && message.trim().length) {
      return message;
    }
  } catch (_) {
  }

  return fallback;
}

export function getAiImproveTranslationTooltipText() {
  return getMessageWithFallback("tooltipImproveTranslationByAI", "");
}

export function getFloatingButtonGoogleTooltipText() {
  return getMessageWithFallback(
    "floatingButtonGoogleTranslateTooltip",
    "Show Google translation"
  );
}

export function getFloatingButtonAiTooltipText() {
  return getMessageWithFallback(
    "floatingButtonAiTranslateTooltip",
    "Show AI translation"
  );
}

export function getFloatingButtonOriginalTooltipText() {
  return getMessageWithFallback(
    "floatingButtonOriginalTooltip",
    "Show original text"
  );
}

export function getFloatingButtonMoreOptionsText() {
  return getMessageWithFallback("btnMoreOptions", "More options");
}