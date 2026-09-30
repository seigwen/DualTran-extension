"use strict";

import {
  detectTabLanguageForSender,
  getTabHostNameFromSender,
  getActiveTabMimeType,
  queryMainFrame,
} from "./runtimeMessageHelpers.js";
import { buildIssueUrl } from "../lib/feedbackLink.js";

export function buildOpenOptionsPageEffect(optionsPageUrl) {
  if (!optionsPageUrl) {
    return [];
  }

  return [{
    type: "open-tab",
    url: optionsPageUrl,
  }];
}

/**
 * Build the open-tab effect for a feedback-issue report (plan 35).
 *
 * The content script's `openFeedbackIssue` message carries the error-path
 * context (serviceType / errorText / hostname / language pair); the SW
 * supplies the environment facts it alone can see (manifest version,
 * navigator.userAgent) plus the user's AI provider when the report is about
 * the AI path.
 *
 * Contract:
 *   - serviceType must be "google" or "ai" → anything else is a no-op
 *     (returns [], no tab opens — a malformed message must never navigate).
 *   - a missing version is a no-op too (the form's version field is required;
 *     an issue without it is noise).
 *   - the effect is a plain open-tab; validation / URL construction lives in
 *     `buildIssueUrl` (single source of truth, shared with the options page).
 *
 * @param {Object} [payload]
 * @param {"google"|"ai"} [payload.serviceType]
 * @param {string} [payload.errorText]
 * @param {string} [payload.hostname]
 * @param {string} [payload.sourceLang]
 * @param {string} [payload.targetLang]
 * @param {string} [payload.version] - extension version (SW: runtime manifest)
 * @param {string} [payload.userAgent] - browser UA (SW: navigator.userAgent)
 * @param {string} [payload.providerId] - AI provider id (ai path only)
 * @returns {Array<{type: string, url: string}>}
 */
export function buildOpenFeedbackIssueEffect(payload = {}) {
  if (payload?.serviceType !== "google" && payload?.serviceType !== "ai") {
    return [];
  }

  const url = buildIssueUrl({
    version: payload.version,
    userAgent: payload.userAgent,
    serviceType: payload.serviceType,
    providerId: payload.providerId,
    errorText: payload.errorText,
    hostname: payload.hostname,
    sourceLang: payload.sourceLang,
    targetLang: payload.targetLang,
  });

  if (!url) {
    return [];
  }

  return [{
    type: "open-tab",
    url,
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
