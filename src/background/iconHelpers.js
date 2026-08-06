"use strict";

export function resolveActionIconPath({
  pageLanguageState,
  popupBlueWhenSiteIsTranslated,
}) {
  if (pageLanguageState === "translated" && popupBlueWhenSiteIsTranslated === "yes") {
    return "/icons/icon-32-translated.png";
  }

  return "/icons/icon-32.png";
}

export function resolvePageActionVisibility(showButtonInTheAddressBar) {
  return showButtonInTheAddressBar === "no" ? "hide" : "show";
}

export function resolveTabIncognitoState(tabs, tabId) {
  const tabInfo = (tabs || []).find((tab) => tab?.id === tabId);
  return Boolean(tabInfo?.incognito);
}

export function buildIconEffectPlan({
  tabId,
  hasPageAction,
  hasAction,
  pageActionIconPath,
  actionIconPath,
  showButtonInTheAddressBar,
}) {
  const effects = [];

  if (hasPageAction) {
    effects.push({
      type: "reset-page-action",
      tabId,
      forceShow: false,
    });
    effects.push({
      type: "set-page-action-icon",
      tabId,
      path: pageActionIconPath,
    });
    effects.push({
      type: resolvePageActionVisibility(showButtonInTheAddressBar) === "hide"
        ? "hide-page-action"
        : "show-page-action",
      tabId,
    });
  }

  if (hasAction) {
    effects.push({
      type: "set-action-icon",
      tabId,
      path: actionIconPath,
    });
  }

  return effects;
}

export function buildAllTabIconRefreshPlan(tabs) {
  return (tabs || [])
    .map((tab) => tab?.id)
    .filter((tabId) => tabId !== undefined && tabId !== null);
}

export function resolveThemeColorState(themeLike) {
  const colors = themeLike?.colors || themeLike?.theme?.colors;

  return {
    themeColorFieldText: colors?.toolbar_field_text || null,
    themeColorAttention: colors?.icons_attention || null,
  };
}

export function buildThemeIconRefreshPlan(themeLike) {
  return {
    ...resolveThemeColorState(themeLike),
    shouldRefreshAllTabs: true,
  };
}

export function resolveSvgIconAppearance({
  pageLanguageState,
  popupBlueWhenSiteIsTranslated,
  themeColorFieldText,
  themeColorAttention,
  darkMode = false,
  incognito = false,
}) {
  if (pageLanguageState === "translated" && popupBlueWhenSiteIsTranslated === "yes") {
    if (themeColorAttention) {
      return {
        fillOpacity: "1.0",
        fillColor: themeColorAttention,
      };
    }

    return {
      fillOpacity: "1.0",
      fillColor: darkMode || incognito ? "#00ddff" : "#0061e0",
    };
  }

  if (themeColorFieldText) {
    return {
      fillOpacity: "0.5",
      fillColor: themeColorFieldText,
    };
  }

  return {
    fillOpacity: "0.5",
    fillColor: darkMode || incognito ? "white" : "black",
  };
}

export function resolveIconUpdateOnTabLoading(status) {
  if (status !== "loading") {
    return null;
  }

  return {
    nextPageLanguageState: "original",
  };
}

export function resolveIconUpdateOnTabActivated(tabId) {
  return {
    nextPageLanguageState: "original",
    updateTabId: tabId,
    queryMessage: {
      action: "getCurrentPageLanguageState",
    },
    frameId: 0,
  };
}

export function resolveIconUpdateFromLanguageState(pageLanguageState, tabId) {
  if (!pageLanguageState) {
    return null;
  }

  return {
    nextPageLanguageState: pageLanguageState,
    updateTabId: tabId,
  };
}

export function resolveIconUpdateFromRuntimeMessage(request, senderTabId) {
  if (request.action !== "setPageLanguageState") {
    return null;
  }

  return resolveIconUpdateFromLanguageState(request.pageLanguageState, senderTabId);
}