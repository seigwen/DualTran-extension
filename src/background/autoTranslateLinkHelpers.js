"use strict";

export function buildActiveTabTranslationInfo(tab, pageLanguageState = "original") {
  return {
    tabId: tab?.id,
    pageLanguageState,
    url: tab?.url,
  };
}

export function buildActiveTabTranslationBootstrap(tab) {
  if (!tab) {
    return null;
  }

  return {
    initialActiveTabTranslationInfo: buildActiveTabTranslationInfo(tab, "original"),
    query: {
      tabId: tab.id,
      message: {
        action: "getCurrentPageLanguageState",
      },
      options: {
        frameId: 0,
      },
    },
  };
}

export function resolveActiveTabTranslationQueryResponse(tab, pageLanguageState) {
  if (!tab) {
    return null;
  }

  return buildActiveTabTranslationInfo(tab, pageLanguageState);
}

export function resolveActiveTabTranslationInfoMessageUpdate(request, sender) {
  if (request?.action !== "setPageLanguageState" || !sender?.tab?.active) {
    return null;
  }

  return buildActiveTabTranslationInfo(sender.tab, request.pageLanguageState);
}

export function buildSitesToAutoTranslateOnCommitted(currentSites, activeTabTranslationInfo, details) {
  const nextSites = { ...(currentSites || {}) };

  const shouldRememberSite =
    details?.transitionType === "link" &&
    details?.frameId === 0 &&
    activeTabTranslationInfo?.pageLanguageState === "translated" &&
    activeTabTranslationInfo?.url &&
    new URL(activeTabTranslationInfo.url).host === new URL(details.url).host;

  if (shouldRememberSite) {
    nextSites[details.tabId] = new URL(details.url).host;
  } else {
    delete nextSites[details?.tabId];
  }

  return nextSites;
}

export function buildSitesToAutoTranslateRemoval(currentSites, tabId) {
  const nextSites = { ...(currentSites || {}) };
  delete nextSites[tabId];
  return nextSites;
}

export function resolveAutoTranslateOnDOMContentLoaded(currentSites, details) {
  const nextSites = { ...(currentSites || {}) };

  if (details?.frameId !== 0) {
    return {
      shouldSchedule: false,
      nextSitesToAutoTranslate: nextSites,
    };
  }

  const host = new URL(details.url).host;
  const shouldSchedule = nextSites[details.tabId] === host;

  delete nextSites[details.tabId];

  return {
    shouldSchedule,
    tabId: details.tabId,
    nextSitesToAutoTranslate: nextSites,
  };
}

export function buildAutoTranslateDomExecutionPlan(result) {
  if (!result?.shouldSchedule) {
    return [];
  }

  return [
    {
      type: "set-storage",
      update: {
        tabToAutoTranslate: result.tabId,
      },
    },
    {
      type: "create-alarm",
      name: "alarmAutoTranslate",
      alarmInfo: {
        delayInMinutes: 0.01,
      },
    },
  ];
}