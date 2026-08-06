"use strict";

const MISSING_WEB_NAVIGATION_MESSAGE = "No webNavigation permission";

export function executeAutoTranslateListenerEffects(effects, {
  setActiveTabTranslationInfo,
  setSitesToAutoTranslate,
  invokeListener,
  logInfo,
} = {}) {
  (effects || []).forEach((effect) => {
    if (effect?.type === "reset-state") {
      setActiveTabTranslationInfo?.(effect.resetState.activeTabTranslationInfo);
      setSitesToAutoTranslate?.(effect.resetState.sitesToAutoTranslate);
    } else if (effect?.type === "listener-call") {
      invokeListener?.(effect.target, effect.method, effect.listener);
    } else if (effect?.type === "log-info") {
      logInfo?.(effect.message);
    }
  });
}

export function createAutoTranslateListenerEffectExecutor({
  setActiveTabTranslationInfo,
  setSitesToAutoTranslate,
  invokeListener,
  logInfo,
} = {}) {
  return function executeEffects(effects) {
    executeAutoTranslateListenerEffects(effects, {
      setActiveTabTranslationInfo,
      setSitesToAutoTranslate,
      invokeListener,
      logInfo,
    });
  };
}

export function createAutoTranslateListenerInvoker({ listenerApis, listeners } = {}) {
  return function invokeListener(target, method, listenerName) {
    const listenerApi = listenerApis?.[target];
    const listener = listeners?.[listenerName];

    if (!listenerApi || typeof listenerApi[method] !== "function") {
      return;
    }

    if (typeof listener !== "function") {
      return;
    }

    listenerApi[method](listener);
  };
}

export function buildAutoTranslateListenerEffects(entries = []) {
  return (entries || []).map((entry) => ({
    type: "listener-call",
    target: entry.target,
    method: entry.method,
    listener: entry.listener,
  }));
}

export function buildEnableAutoTranslateExecutionPlan(plan) {
  if (!plan?.shouldProceed) {
    return [];
  }

  return buildAutoTranslateListenerEffects(plan.addListeners);
}

export function buildDisableAutoTranslateExecutionPlan({ plan, resetState }) {
  const effects = [];

  if (plan?.shouldResetState) {
    effects.push({
      type: "reset-state",
      resetState,
    });
  }

  effects.push(...buildAutoTranslateListenerEffects(plan?.removeListeners));

  if (plan?.shouldLogMissingWebNavigation) {
    effects.push({
      type: "log-info",
      message: MISSING_WEB_NAVIGATION_MESSAGE,
    });
  }

  return effects;
}

export { MISSING_WEB_NAVIGATION_MESSAGE };