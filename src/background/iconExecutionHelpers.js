"use strict";

import {
  buildAllTabIconRefreshPlan,
  resolveIconUpdateFromLanguageState,
  resolveIconUpdateOnTabActivated,
  resolveTabIncognitoState,
} from "./iconHelpers.js";
import { queryMainFrame } from "./runtimeMessageHelpers.js";

export function executeIconEffects(effects, {
  resetPageAction,
  setPageActionIcon,
  hidePageAction,
  showPageAction,
  setActionIcon,
} = {}) {
  (effects || []).forEach((effect) => {
    if (effect?.type === "reset-page-action" && typeof resetPageAction === "function") {
      resetPageAction(effect.tabId, effect.forceShow);
    } else if (effect?.type === "set-page-action-icon" && typeof setPageActionIcon === "function") {
      setPageActionIcon({
        tabId: effect.tabId,
        path: effect.path,
      });
    } else if (effect?.type === "hide-page-action" && typeof hidePageAction === "function") {
      hidePageAction(effect.tabId);
    } else if (effect?.type === "show-page-action" && typeof showPageAction === "function") {
      showPageAction(effect.tabId);
    } else if (effect?.type === "set-action-icon" && typeof setActionIcon === "function") {
      setActionIcon({
        tabId: effect.tabId,
        path: effect.path,
      });
    }
  });
}

export function createIconEffectExecutor({
  resetPageAction,
  setPageActionIcon,
  hidePageAction,
  showPageAction,
  setActionIcon,
} = {}) {
  return function executeEffects(effects) {
    executeIconEffects(effects, {
      resetPageAction,
      setPageActionIcon,
      hidePageAction,
      showPageAction,
      setActionIcon,
    });
  };
}

export function executeQueriedTabIconRefresh(tabId, {
  queryTabs,
  applyIconUpdate,
} = {}) {
  if (tabId === undefined || tabId === null || typeof queryTabs !== "function") {
    return;
  }

  queryTabs({}, (tabs) => {
    applyIconUpdate?.(tabId, resolveTabIncognitoState(tabs, tabId));
  });
}

export function executeAllTabIconRefresh({
  queryTabs,
  applyIconUpdate,
} = {}) {
  if (typeof queryTabs !== "function") {
    return;
  }

  queryTabs({}, (tabs) => {
    buildAllTabIconRefreshPlan(tabs).forEach((tabId) => {
      applyIconUpdate?.(tabId, resolveTabIncognitoState(tabs, tabId));
    });
  });
}

export async function executeActivatedTabIconRefresh(tabId, {
  setPageLanguageState,
  applyIconUpdate,
  sendTabMessage,
  afterSend,
} = {}) {
  if (tabId === undefined || tabId === null || !sendTabMessage) {
    return null;
  }

  const activation = resolveIconUpdateOnTabActivated(tabId);
  setPageLanguageState?.(activation.nextPageLanguageState);
  applyIconUpdate?.(activation.updateTabId);

  const pageLanguageState = await queryMainFrame(
    activation.updateTabId,
    activation.queryMessage.action,
    sendTabMessage,
    afterSend
  );

  const responseUpdate = resolveIconUpdateFromLanguageState(
    pageLanguageState,
    activation.updateTabId
  );
  if (responseUpdate) {
    setPageLanguageState?.(responseUpdate.nextPageLanguageState);
    applyIconUpdate?.(responseUpdate.updateTabId);
  }

  return responseUpdate;
}