"use strict";

import {
  buildTranslatePageContextMenuConfig,
  buildTranslateSelectedContextMenuConfig,
  getTranslatePageContextMenuTitle,
} from "./contextMenuHelpers.js";
import {
  buildActivatedContextMenuPlan,
  resolveActivatedContextMenuResponse,
} from "./tabStateHelpers.js";
import { queryMainFrame } from "./runtimeMessageHelpers.js";

export function executeContextMenuEffects(effects, {
  removeContextMenu,
  createContextMenu,
  createCallback,
  removeCallback,
} = {}) {
  (effects || []).forEach((effect) => {
    if (effect?.type === "remove-context-menu" && typeof removeContextMenu === "function") {
      removeContextMenu(effect.menuId, removeCallback);
    } else if (effect?.type === "create-context-menu" && typeof createContextMenu === "function") {
      createContextMenu(effect.config, createCallback);
    }
  });
}

export function executeStaticContextMenuRegistration(configs, {
  createContextMenu,
  createCallback,
} = {}) {
  if (typeof createContextMenu !== "function") {
    return;
  }

  (configs || []).forEach((config) => {
    createContextMenu(config, createCallback);
  });
}

export function buildContextMenuRefreshEffects(menuId, config) {
  const effects = [{
    type: "remove-context-menu",
    menuId,
  }];

  if (config) {
    effects.push({
      type: "create-context-menu",
      config,
    });
  }

  return effects;
}

export function buildTranslateSelectedContextMenuEffects(config) {
  return buildContextMenuRefreshEffects("translate-selected-text", config);
}

export function buildTranslatePageContextMenuEffects(config) {
  return buildContextMenuRefreshEffects("translate-web-page", config);
}

export function buildTranslateSelectedContextMenuRefreshPlan({ isEnabled, title }) {
  return buildTranslateSelectedContextMenuEffects(
    buildTranslateSelectedContextMenuConfig(isEnabled, title)
  );
}

export function buildTranslatePageContextMenuRefreshPlan({
  isEnabled,
  pageLanguageState = "original",
  restoreLabel,
  targetLanguageName,
  buildTranslateForLabel,
}) {
  const title = getTranslatePageContextMenuTitle({
    pageLanguageState,
    restoreLabel,
    targetLanguageName,
    buildTranslateForLabel,
  });

  return buildTranslatePageContextMenuEffects(
    buildTranslatePageContextMenuConfig(isEnabled, title)
  );
}

export async function executeActivatedContextMenuRefresh(tabId, {
  applyContextMenuRefresh,
  sendTabMessage,
  afterSend,
} = {}) {
  if (tabId === undefined || tabId === null || !sendTabMessage) {
    return null;
  }

  const plan = buildActivatedContextMenuPlan(tabId);
  applyContextMenuRefresh?.(plan.initialPageLanguageState);

  const pageLanguageState = await queryMainFrame(
    plan.query.tabId,
    plan.query.message.action,
    sendTabMessage,
    afterSend
  );
  const response = resolveActivatedContextMenuResponse(pageLanguageState);
  if (response) {
    applyContextMenuRefresh?.(response.pageLanguageState);
  }

  return response;
}