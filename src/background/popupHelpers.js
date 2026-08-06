"use strict";

export function resolvePopupPath({ translateClickingOnce, useOldPopup, forceShow = false }) {
  if (translateClickingOnce === "yes" && !forceShow) {
    return null;
  }

  return useOldPopup === "yes" ? "popup/old-popup.html" : "popup/popup.html";
}

export function buildPageActionPopupConfig(tabId, options) {
  return {
    popup: resolvePopupPath(options),
    tabId,
  };
}

export function buildBrowserActionPopupConfig(options) {
  return {
    popup: resolvePopupPath(options),
  };
}