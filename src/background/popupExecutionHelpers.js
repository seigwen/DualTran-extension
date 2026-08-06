"use strict";

import {
  buildBrowserActionPopupConfig,
  buildPageActionPopupConfig,
} from "./popupHelpers.js";

export function applyPageActionPopupReset({
  tabId,
  forceShow = false,
  translateClickingOnce,
  useOldPopup,
  setPageActionPopup,
}) {
  if (typeof setPageActionPopup !== "function") {
    return;
  }

  setPageActionPopup(
    buildPageActionPopupConfig(tabId, {
      translateClickingOnce,
      useOldPopup,
      forceShow,
    })
  );
}

export function applyBrowserActionPopupReset({
  forceShow = false,
  translateClickingOnce,
  useOldPopup,
  setBrowserActionPopup,
}) {
  if (typeof setBrowserActionPopup !== "function") {
    return;
  }

  setBrowserActionPopup(
    buildBrowserActionPopupConfig({
      translateClickingOnce,
      useOldPopup,
      forceShow,
    })
  );
}

export function executeActivePageActionPopupReset({
  forceShow = false,
  translateClickingOnce,
  useOldPopup,
  queryTabs,
  setPageActionPopup,
} = {}) {
  if (typeof queryTabs !== "function") {
    return;
  }

  queryTabs(
    {
      currentWindow: true,
      active: true,
    },
    (tabs) => {
      const tabId = tabs?.[0]?.id;
      if (tabId === undefined || tabId === null) {
        return;
      }

      applyPageActionPopupReset({
        tabId,
        forceShow,
        translateClickingOnce,
        useOldPopup,
        setPageActionPopup,
      });
    }
  );
}

export function executePopupEffects(effects, {
  resetBrowserAction,
  openBrowserActionPopup,
  resetPageAction,
  setPageActionPopup,
  openPageActionPopup,
} = {}) {
  (effects || []).forEach((effect) => {
    if (effect?.type === "reset-browser-action" && typeof resetBrowserAction === "function") {
      resetBrowserAction(effect.forceShow);
    } else if (effect?.type === "open-browser-action-popup" && typeof openBrowserActionPopup === "function") {
      openBrowserActionPopup();
    } else if (effect?.type === "reset-page-action" && typeof resetPageAction === "function") {
      resetPageAction(effect.tabId, effect.forceShow);
    } else if (effect?.type === "set-page-action-popup" && typeof setPageActionPopup === "function") {
      setPageActionPopup(effect.popupConfig);
    } else if (effect?.type === "open-page-action-popup" && typeof openPageActionPopup === "function") {
      openPageActionPopup();
    }
  });
}