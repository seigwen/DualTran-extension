"use strict";

import { resolveHotkeyCommandPlan } from "./commandHelpers.js";

export function executeCommandEffects(effects, {
  setConfig,
  setTargetLanguage,
  executeTabEffect,
} = {}) {
  (effects || []).forEach((effect) => {
    if (effect?.type === "set-config") {
      setConfig?.(effect.key, effect.value);
    } else if (effect?.type === "set-target-language") {
      setTargetLanguage?.(effect.value);
    } else {
      executeTabEffect?.(effect);
    }
  });
}

export function createCommandEffectExecutor({
  setConfig,
  setTargetLanguage,
  applyTabEffects,
} = {}) {
  return function executeEffects(effects) {
    executeCommandEffects(effects, {
      setConfig,
      setTargetLanguage,
      executeTabEffect(effect) {
        applyTabEffects?.([effect]);
      },
    });
  };
}

export function buildHotkeyEffectPlan(plan, tabs = []) {
  if (!plan) {
    return [];
  }

  const effects = [];

  if (plan.nextPageTranslatorService) {
    effects.push({
      type: "set-config",
      key: "pageTranslatorService",
      value: plan.nextPageTranslatorService,
    });
  }

  if (plan.nextTargetLanguage) {
    effects.push({
      type: "set-target-language",
      value: plan.nextTargetLanguage,
    });
  }

  const targetTabId = tabs?.[0]?.id;
  if (targetTabId !== undefined && targetTabId !== null) {
    effects.push({
      type: "send-tab-message",
      tabId: targetTabId,
      message: plan.message,
    });
  }

  return effects;
}

export function executeHotkeyCommand(command, {
  currentPageTranslatorService,
  targetLanguages,
  queryTabs,
  executeEffects,
} = {}) {
  const plan = resolveHotkeyCommandPlan(command, {
    currentPageTranslatorService,
    targetLanguages,
  });

  if (!plan || typeof queryTabs !== "function") {
    return null;
  }

  queryTabs(plan.tabQuery, (tabs) => {
    executeEffects?.(buildHotkeyEffectPlan(plan, tabs));
  });

  return plan;
}