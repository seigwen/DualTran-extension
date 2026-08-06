"use strict";

import {
  resolveAutoTranslateAlarmDispatch,
  resolveAutoTranslatePermissionBootstrap,
} from "./autoTranslateRuntimeHelpers.js";

export function executeAutoTranslateRuntimeEffects(effects, {
  toggleAutoTranslate,
  setConfig,
} = {}) {
  (effects || []).forEach((effect) => {
    if (effect?.type === "toggle-auto-translate") {
      toggleAutoTranslate?.(effect.action);
    } else if (effect?.type === "set-config") {
      setConfig?.(effect.key, effect.value);
    }
  });
}

export function createAutoTranslateRuntimeEffectExecutor({
  toggleAutoTranslate,
  setConfig,
} = {}) {
  return function executeEffects(effects) {
    executeAutoTranslateRuntimeEffects(effects, {
      toggleAutoTranslate,
      setConfig,
    });
  };
}

export function createAutoTranslateToggleInvoker({ toggles } = {}) {
  return function toggleAutoTranslate(action) {
    const handler = toggles?.[action];

    if (typeof handler !== "function") {
      return;
    }

    handler();
  };
}

export function buildAutoTranslateAlarmExecutionPlan(dispatch) {
  if (!dispatch) {
    return [];
  }

  return [{
    type: "send-tab-message",
    tabId: dispatch.tabId,
    message: dispatch.message,
    options: {
      frameId: dispatch.frameId,
    },
  }];
}

export async function executeAutoTranslateAlarm(alarmInfo, {
  getStorage,
  applyTabEffects,
} = {}) {
  if (typeof getStorage !== "function") {
    return null;
  }

  const dispatch = resolveAutoTranslateAlarmDispatch(
    alarmInfo,
    await getStorage(["tabToAutoTranslate"])
  );
  await applyTabEffects?.(buildAutoTranslateAlarmExecutionPlan(dispatch));
  return dispatch;
}

export function buildAutoTranslateConfigToggleEffects(action) {
  if (action !== "enable" && action !== "disable") {
    return [];
  }

  return [{
    type: "toggle-auto-translate",
    action,
  }];
}

export function buildAutoTranslatePermissionRemovedEffects(shouldDisable) {
  if (!shouldDisable) {
    return [];
  }

  return [{
    type: "set-config",
    key: "autoTranslateWhenClickingALink",
    value: "no",
  }];
}

export function buildAutoTranslatePermissionBootstrapEffects(bootstrap) {
  if (bootstrap?.action === "enable") {
    return [{
      type: "toggle-auto-translate",
      action: "enable",
    }];
  }

  if (bootstrap?.action === "force-disable-config") {
    return [{
      type: "set-config",
      key: "autoTranslateWhenClickingALink",
      value: bootstrap.configValue,
    }];
  }

  return [];
}

export function executeAutoTranslatePermissionBootstrap({
  containsPermissions,
  autoTranslateWhenClickingALink,
  executeEffects,
} = {}) {
  if (typeof containsPermissions !== "function") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    containsPermissions(
      {
        permissions: ["webNavigation"],
      },
      (hasPermissions) => {
        const bootstrap = resolveAutoTranslatePermissionBootstrap({
          hasPermissions,
          autoTranslateWhenClickingALink,
        });
        executeEffects?.(buildAutoTranslatePermissionBootstrapEffects(bootstrap));
        resolve(bootstrap);
      }
    );
  });
}