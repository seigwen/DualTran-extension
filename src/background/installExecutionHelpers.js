"use strict";

import { resolveDevelopmentReloadPlan } from "./installHelpers.js";

export function buildStartupExecutionPlan(startupReset) {
  if (!startupReset) {
    return [];
  }

  return [
    {
      type: "set-storage",
      update: {
        tabToMimeType: startupReset.tabToMimeType,
      },
      logMessage: "tabToMimeType write succeeded [object Object]",
    },
    {
      type: "set-storage",
      update: {
        tabHasContentScript: startupReset.tabHasContentScript,
      },
      logMessage: "tabHasContentScript write succeeded [object Object]",
    },
  ];
}

export function buildInstalledExecutionPlan(plan = {}) {
  const effects = [];

  if (plan.shouldSetLastTimeShowingReleaseNotes) {
    effects.push({
      type: "set-config",
      key: "lastTimeShowingReleaseNotes",
      value: plan.nextLastTimeShowingReleaseNotes,
    });
  }

  if (plan.openPageUrl) {
    effects.push({
      type: "open-tab",
      url: plan.openPageUrl,
    });
  }

  if (plan.shouldDeleteTranslationCache) {
    effects.push({
      type: "delete-translation-cache",
    });
  }

  if (plan.shouldDisableDeepL) {
    effects.push({
      type: "set-config",
      key: "enableDeepL",
      value: "no",
    });
  }

  return effects;
}

export function buildDevelopmentReloadExecutionPlan(tabIds = []) {
  return (tabIds || []).map((tabId) => ({
    type: "reload-tab",
    tabId,
  }));
}

export function executeDevelopmentReloadBootstrap({
  reason,
  getSelf,
  queryTabs,
  hasRuntimeError,
  executeReloadEffects,
} = {}) {
  if ((reason !== "install" && reason !== "update") || typeof getSelf !== "function" || typeof queryTabs !== "function") {
    return;
  }

  getSelf((self) => {
    if (hasRuntimeError?.()) {
      return;
    }

    if (!self) {
      return;
    }

    queryTabs({}, (tabs) => {
      if (hasRuntimeError?.()) {
        return;
      }

      executeReloadEffects?.(
        buildDevelopmentReloadExecutionPlan(
          resolveDevelopmentReloadPlan({
            reason,
            installType: self.installType,
            tabs,
          })
        )
      );
    });
  });
}

export function executeInstallEffects(effects, {
  setConfig,
  deleteTranslationCache,
  executeTabEffect,
} = {}) {
  (effects || []).forEach((effect) => {
    if (effect?.type === "set-config") {
      setConfig?.(effect.key, effect.value);
    } else if (effect?.type === "delete-translation-cache") {
      deleteTranslationCache?.();
    } else {
      executeTabEffect?.(effect);
    }
  });
}

export function createInstallEffectExecutor({
  setConfig,
  deleteTranslationCache,
  applyTabEffects,
} = {}) {
  return function executeEffects(effects) {
    executeInstallEffects(effects, {
      setConfig,
      deleteTranslationCache,
      executeTabEffect(effect) {
        applyTabEffects?.([effect]);
      },
    });
  };
}