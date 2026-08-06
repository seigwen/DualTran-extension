"use strict";

import {
  resolvePdfMenuExecutionFromStorage,
  resolveTranslateSelectedMenuClickFromStorage,
} from "./menuClickHelpers.js";

const MISSING_PDF_MIME_TYPE_ERROR = "error:result.tabToMimeType[tab.id] is undefined";

export function buildBasicMenuEffectPlan(basicAction) {
  if (!basicAction) {
    return [];
  }

  if (basicAction.type === "send-tab-message") {
    return [basicAction];
  }

  if (basicAction.type === "run-popup-sequence") {
    return basicAction.steps || [];
  }

  if (basicAction.type === "add-never-translate-site") {
    return [{
      type: "add-never-translate-site",
      hostname: basicAction.hostname,
    }];
  }

  if (basicAction.type === "open-tab") {
    return [{
      type: "open-tab",
      url: basicAction.url,
    }];
  }

  return [];
}

export function executeMenuEffects(effects, {
  addNeverTranslateSite,
  logError,
  applyPopupEffects,
  applyTabEffects,
} = {}) {
  (effects || []).forEach((effect) => {
    if (effect?.type === "add-never-translate-site") {
      addNeverTranslateSite?.(effect.hostname);
    } else if (effect?.type === "log-error") {
      logError?.(effect.message);
    } else {
      applyPopupEffects?.([effect]);
      applyTabEffects?.([effect]);
    }
  });
}

export function createMenuEffectExecutor({
  addNeverTranslateSite,
  logError,
  applyPopupEffects,
  applyTabEffects,
} = {}) {
  return function executeEffects(effects) {
    executeMenuEffects(effects, {
      addNeverTranslateSite,
      logError,
      applyPopupEffects,
      applyTabEffects,
    });
  };
}

export function buildTranslateSelectedEffectPlan(nextAction, tabId) {
  if (!nextAction) {
    return [];
  }

  if (nextAction.type === "open-page-action-popup") {
    return [
      {
        type: "set-page-action-popup",
        popupConfig: nextAction.popupConfig,
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

  if (nextAction.type === "send-message") {
    return [{
      type: "send-tab-message",
      tabId,
      message: nextAction.message,
    }];
  }

  return [];
}

export async function executeTranslateSelectedFromStorage({
  tabId,
  selectionText,
  hasPageActionOpenPopup,
  isInReaderMode,
  getStorage,
  applyEffects,
} = {}) {
  if (tabId === undefined || tabId === null || typeof getStorage !== "function") {
    return null;
  }

  const storageResult = await getStorage(["tabHasContentScript"]);
  const nextAction = resolveTranslateSelectedMenuClickFromStorage({
    storageResult,
    hasPageActionOpenPopup,
    isInReaderMode,
    selectionText,
    tabId,
  });
  const effects = buildTranslateSelectedEffectPlan(nextAction, tabId);
  applyEffects?.(effects);
  return nextAction;
}

export function buildPdfMenuEffectPlan(nextAction) {
  if (!nextAction || nextAction.type === "noop") {
    return [];
  }

  if (nextAction.type === "missing-mime-type") {
    return [{
      type: "log-error",
      message: MISSING_PDF_MIME_TYPE_ERROR,
    }];
  }

  if (nextAction.type === "open-popup") {
    return [{
      type: nextAction.popupTarget === "browserAction"
        ? "open-browser-action-popup"
        : "open-page-action-popup",
    }];
  }

  if (nextAction.type === "open-tab") {
    return [{
      type: "open-tab",
      url: nextAction.url,
    }];
  }

  return [];
}

export async function executePdfMenuFromStorage({
  tabId,
  canOpenPopup,
  popupTarget,
  websiteUrl,
  getStorage,
  applyEffects,
} = {}) {
  if (tabId === undefined || tabId === null || typeof getStorage !== "function") {
    return null;
  }

  const storageResult = await getStorage(["tabToMimeType"]);
  const nextAction = resolvePdfMenuExecutionFromStorage({
    storageResult,
    tabId,
    canOpenPopup,
    popupTarget,
    websiteUrl,
  });
  const effects = buildPdfMenuEffectPlan(nextAction);
  applyEffects?.(effects);
  return nextAction;
}

export { MISSING_PDF_MIME_TYPE_ERROR };