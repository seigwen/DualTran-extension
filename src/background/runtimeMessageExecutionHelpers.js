"use strict";

import {
  detectTabLanguageForSender,
  getTabHostNameFromSender,
  getActiveTabMimeType,
  queryMainFrame,
} from "./runtimeMessageHelpers.js";

export function buildOpenOptionsPageEffect(optionsPageUrl) {
  if (!optionsPageUrl) {
    return [];
  }

  return [{
    type: "open-tab",
    url: optionsPageUrl,
  }];
}

export function buildOpenDonationPageEffect(donationPageUrl) {
  if (!donationPageUrl) {
    return [];
  }

  return [{
    type: "open-tab",
    url: donationPageUrl,
  }];
}

export function buildFrameFocusBroadcastEffect(sender) {
  const tabId = sender?.tab?.id;
  if (tabId === undefined || tabId === null) {
    return [];
  }

  return [{
    type: "send-tab-message",
    tabId,
    message: {
      action: "anotherFrameIsInFocus",
    },
  }];
}

export function createRuntimeMessageEffectExecutor({
  applyTabEffects,
} = {}) {
  return function executeEffects(effects) {
    applyTabEffects?.(effects);
  };
}

export function executeQueriedActiveTabMimeType({
  queryTabs,
  getStorage,
} = {}) {
  if (typeof queryTabs !== "function" || typeof getStorage !== "function") {
    return Promise.resolve(undefined);
  }

  return getActiveTabMimeType(queryTabs, getStorage);
}

export function executeMainFrameRuntimeQuery({
  sender,
  action,
  sendTabMessage,
  afterSend,
} = {}) {
  const tabId = sender?.tab?.id;
  if ((tabId === undefined || tabId === null) || !action || typeof sendTabMessage !== "function") {
    return Promise.resolve(undefined);
  }

  return queryMainFrame(tabId, action, sendTabMessage, afterSend);
}

export function executeSenderTabLanguageQuery({
  sender,
  detectLanguage,
} = {}) {
  if (typeof detectLanguage !== "function") {
    return Promise.resolve("und");
  }

  return detectTabLanguageForSender(sender, detectLanguage);
}

export function executeSenderTabHostNameQuery(sender) {
  if (!sender?.tab?.url) {
    return undefined;
  }

  return getTabHostNameFromSender(sender);
}
