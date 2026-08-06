"use strict";

import { collectTabIds } from "./actionClickHelpers.js";

export function executeActionClickEffects(effects, {
  hidePageAction,
  sendTabMessage,
  sendMessageCallback,
} = {}) {
  (effects || []).forEach((effect) => {
    if (effect?.type === "hide-page-action" && typeof hidePageAction === "function") {
      hidePageAction(effect.tabId);
    } else if (effect?.type === "send-tab-message" && typeof sendTabMessage === "function") {
      if (effect.options !== undefined && sendMessageCallback) {
        sendTabMessage(effect.tabId, effect.message, effect.options, sendMessageCallback);
      } else if (effect.options !== undefined) {
        sendTabMessage(effect.tabId, effect.message, effect.options);
      } else if (sendMessageCallback) {
        sendTabMessage(effect.tabId, effect.message, sendMessageCallback);
      } else {
        sendTabMessage(effect.tabId, effect.message);
      }
    }
  });
}

export function createActionClickEffectExecutor({
  hidePageAction,
  sendTabMessage,
  sendMessageCallback,
} = {}) {
  return function executeEffects(effects) {
    executeActionClickEffects(effects, {
      hidePageAction,
      sendTabMessage,
      sendMessageCallback,
    });
  };
}

export function buildPageActionHideEffects(tabIds = []) {
  return (tabIds || [])
    .filter((tabId) => tabId !== undefined && tabId !== null)
    .map((tabId) => ({
      type: "hide-page-action",
      tabId,
    }));
}

export function executeInitialPageActionHide({
  queryTabs,
  applyEffects,
} = {}) {
  if (typeof queryTabs !== "function") {
    return;
  }

  queryTabs({}, (tabs) => {
    applyEffects?.(buildPageActionHideEffects(collectTabIds(tabs)));
  });
}

export function buildMobileActionClickEffects(tabId, message) {
  if (tabId === undefined || tabId === null || !message) {
    return [];
  }

  return [{
    type: "send-tab-message",
    tabId,
    message,
    options: {
      frameId: 0,
    },
  }];
}

export function buildDesktopActionClickEffects(tabId, message) {
  if (tabId === undefined || tabId === null || !message) {
    return [];
  }

  return [{
    type: "send-tab-message",
    tabId,
    message,
  }];
}