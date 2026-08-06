"use strict";

export function buildTranslateSelectedContextMenuConfig(isEnabled, title) {
  if (!isEnabled) {
    return null;
  }

  return {
    id: "translate-selected-text",
    title,
    contexts: ["selection"],
  };
}

export function getTranslatePageContextMenuTitle({
  pageLanguageState = "original",
  restoreLabel,
  targetLanguageName,
  buildTranslateForLabel,
}) {
  if (pageLanguageState === "translated") {
    return restoreLabel;
  }

  return buildTranslateForLabel(targetLanguageName);
}

export function buildTranslatePageContextMenuConfig(isEnabled, title) {
  if (!isEnabled) {
    return null;
  }

  return {
    id: "translate-web-page",
    title,
    contexts: ["page", "frame"],
  };
}