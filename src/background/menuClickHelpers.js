"use strict";

export function buildPopupMenuExecution({ menuItemId, tabId }) {
  if (menuItemId === "browserAction-showPopup") {
    return [
      {
        type: "reset-browser-action",
        forceShow: true,
      },
      {
        type: "open-browser-action-popup",
      },
      {
        type: "reset-browser-action",
        forceShow: false,
      },
    ];
  }

  if (menuItemId === "pageAction-showPopup") {
    return [
      {
        type: "reset-page-action",
        tabId,
        forceShow: true,
      },
      {
        type: "open-page-action-popup",
      },
      {
        type: "reset-page-action",
        tabId,
        forceShow: false,
      },
    ];
  }

  return null;
}

export function resolveBasicMenuClickAction({ menuItemId, tabId, tabUrl, optionsPageUrl }) {
  if (menuItemId === "translate-web-page") {
    return {
      type: "send-tab-message",
      tabId,
      message: {
        action: "toggle-translation",
      },
    };
  }

  if (menuItemId === "browserAction-showPopup") {
    return {
      type: "run-popup-sequence",
      steps: buildPopupMenuExecution({ menuItemId, tabId }),
    };
  }

  if (menuItemId === "pageAction-showPopup") {
    return {
      type: "run-popup-sequence",
      steps: buildPopupMenuExecution({ menuItemId, tabId }),
    };
  }

  if (menuItemId === "never-translate") {
    return {
      type: "add-never-translate-site",
      hostname: new URL(tabUrl).hostname,
    };
  }

  if (menuItemId === "more-options") {
    return {
      type: "open-tab",
      url: optionsPageUrl,
    };
  }

  return null;
}

export function shouldOpenPageActionPopupForSelection({
  hasPageActionOpenPopup,
  hasContentScript,
  isInReaderMode,
}) {
  return Boolean(hasPageActionOpenPopup && (!hasContentScript || isInReaderMode));
}

export function resolveTranslateSelectedMenuClick({
  hasPageActionOpenPopup,
  hasContentScript,
  isInReaderMode,
  selectionText,
  tabId,
}) {
  if (
    shouldOpenPageActionPopupForSelection({
      hasPageActionOpenPopup,
      hasContentScript,
      isInReaderMode,
    })
  ) {
    return {
      type: "open-page-action-popup",
      popupConfig: buildTranslateSelectedPopupConfig(selectionText, tabId),
    };
  }

  return {
    type: "send-message",
    message: {
      action: "TranslateSelectedText",
      selectionText,
    },
  };
}

export function resolveTranslateSelectedMenuClickFromStorage({
  storageResult,
  hasPageActionOpenPopup,
  isInReaderMode,
  selectionText,
  tabId,
}) {
  return resolveTranslateSelectedMenuClick({
    hasPageActionOpenPopup,
    hasContentScript: !!storageResult?.tabHasContentScript?.[tabId],
    isInReaderMode,
    selectionText,
    tabId,
  });
}

export function buildTranslateSelectedPopupConfig(selectionText, tabId) {
  return {
    popup: "popup/popup-translate-text.html#text=" + encodeURIComponent(selectionText),
    tabId,
  };
}

export function resolvePdfMenuAction({ mimeType, canOpenPopup }) {
  if (!mimeType) {
    return "noop";
  }

  if (mimeType.toLowerCase() === "application/pdf" && canOpenPopup) {
    return "open-popup";
  }

  return "open-website";
}

export function resolvePdfMenuExecution({
  mimeType,
  canOpenPopup,
  popupTarget,
  websiteUrl = "https://translatewebpages.org/",
}) {
  const nextAction = resolvePdfMenuAction({ mimeType, canOpenPopup });

  if (nextAction === "open-popup") {
    return {
      type: "open-popup",
      popupTarget,
    };
  }

  if (nextAction === "open-website") {
    return {
      type: "open-tab",
      url: websiteUrl,
    };
  }

  return {
    type: "noop",
  };
}

export function resolvePdfMenuExecutionFromStorage({
  storageResult,
  tabId,
  canOpenPopup,
  popupTarget,
  websiteUrl,
}) {
  const mimeType = storageResult?.tabToMimeType?.[tabId];

  if (!mimeType) {
    return {
      type: "missing-mime-type",
    };
  }

  return resolvePdfMenuExecution({
    mimeType,
    canOpenPopup,
    popupTarget,
    websiteUrl,
  });
}