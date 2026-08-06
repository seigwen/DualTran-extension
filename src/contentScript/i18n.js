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
    "Use Google to translate this page"
  );
}

export function getFloatingButtonAiTooltipText() {
  return getMessageWithFallback(
    "floatingButtonAiTranslateTooltip",
    "Use AI to translate this page"
  );
}

export function getFloatingButtonMoreOptionsText() {
  return getMessageWithFallback("btnMoreOptions", "More options");
}