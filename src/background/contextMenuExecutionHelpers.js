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

export function buildTranslatePageGoogleContextMenuEffects(config) {
  return buildContextMenuRefreshEffects("translate-page-google", config);
}

export function buildTranslatePageAiContextMenuEffects(config) {
  return buildContextMenuRefreshEffects("translate-page-ai", config);
}

export function buildRestoreOriginalContextMenuEffects(config) {
  return buildContextMenuRefreshEffects("restore-original", config);
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
  if (pageLanguageState === "translated") {
    // Page is translated → show "Restore original" only
    return [
      ...buildTranslatePageGoogleContextMenuEffects(null),  // remove Google item
      ...buildTranslatePageAiContextMenuEffects(null),      // remove AI item
      ...buildRestoreOriginalContextMenuEffects(
        isEnabled ? { id: "restore-original", title: restoreLabel, contexts: ["page", "frame"] } : null
      ),
    ];
  }

  // Page is original → show "Translate with Google" and "Translate with AI"
  const googleTitle = buildTranslateForLabel(targetLanguageName);
  return [
    ...buildRestoreOriginalContextMenuEffects(null),  // remove restore item
    ...buildTranslatePageGoogleContextMenuEffects(
      isEnabled ? { id: "translate-page-google", title: googleTitle, contexts: ["page", "frame"] } : null
    ),
    ...buildTranslatePageAiContextMenuEffects(
      isEnabled ? { id: "translate-page-ai", title: "🤖 " + googleTitle, contexts: ["page", "frame"] } : null
    ),
  ];
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