"use strict";

export function resolveTabUpdatedLifecycleAction({ isTabActive, status }) {
  if (isTabActive && status === "loading") {
    return "refresh-context-menu";
  }

  if (status === "complete") {
    return "probe-content-script";
  }

  return "noop";
}

export function buildActivatedContextMenuPlan(tabId) {
  return {
    initialPageLanguageState: "original",
    query: {
      tabId,
      message: {
        action: "getCurrentPageLanguageState",
      },
      options: {
        frameId: 0,
      },
    },
  };
}

export function resolveActivatedContextMenuResponse(pageLanguageState) {
  if (!pageLanguageState) {
    return null;
  }

  return {
    pageLanguageState,
  };
}

export function buildContentScriptProbePlan(tabId, persistOnlyWhenInjected = false) {
  return {
    tabId,
    message: {
      action: "contentScriptIsInjected",
    },
    options: {
      frameId: 0,
    },
    persistOnlyWhenInjected,
  };
}

export function buildInitialContentScriptProbePlans(tabs = []) {
  return (tabs || [])
    .filter((tab) => tab?.id !== undefined && tab?.id !== null)
    .map((tab) => buildContentScriptProbePlan(tab.id, true));
}

export function buildMimeTypeStorageUpdate(storageResult, tabId, responseHeaders = []) {
  let contentTypeHeader = null;

  for (const header of responseHeaders) {
    if (header.name.toLowerCase() === "content-type") {
      contentTypeHeader = header;
      break;
    }
  }

  const nextTabToMimeType = {
    ...(storageResult?.tabToMimeType || {}),
    [tabId]: contentTypeHeader ? contentTypeHeader.value.split(";", 1)[0] : null,
  };

  return {
    tabToMimeType: nextTabToMimeType,
  };
}

export function buildTabHasContentScriptStorageUpdate(storageResult, tabId, isInjected) {
  return {
    tabHasContentScript: {
      ...(storageResult?.tabHasContentScript || {}),
      [tabId]: Boolean(isInjected),
    },
  };
}

export function buildTabHasContentScriptRemoval(storageResult, tabId) {
  const nextTabHasContentScript = {
    ...(storageResult?.tabHasContentScript || {}),
  };

  delete nextTabHasContentScript[tabId];

  return {
    tabHasContentScript: nextTabHasContentScript,
  };
}

export function buildTabHasContentScriptRemovalWrite(storageResult, tabId) {
  return {
    update: buildTabHasContentScriptRemoval(storageResult, tabId),
  };
}

export function resolveTabHasContentScriptProbeUpdate({
  storageResult,
  tabId,
  response,
  persistOnlyWhenInjected = false,
}) {
  if (persistOnlyWhenInjected && !response) {
    return null;
  }

  return buildTabHasContentScriptStorageUpdate(storageResult, tabId, response);
}

export function buildTabHasContentScriptProbeWrite({
  storageResult,
  tabId,
  response,
  persistOnlyWhenInjected = false,
}) {
  const update = resolveTabHasContentScriptProbeUpdate({
    storageResult,
    tabId,
    response,
    persistOnlyWhenInjected,
  });

  if (!update) {
    return null;
  }

  return { update };
}