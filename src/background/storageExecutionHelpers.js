"use strict";

export function executeStorageEffects(effects, { setStorage, log } = {}) {
  if (typeof setStorage !== "function") {
    return Promise.resolve([]);
  }

  const writer = typeof log === "function" ? log : () => {};

  return Promise.all(
    (effects || []).map((effect) => {
      if (effect?.type !== "set-storage") {
        return undefined;
      }

      return Promise.resolve(setStorage(effect.update)).then(() => {
        if (effect.logMessage !== undefined) {
          writer(effect.logMessage);
        } else if (effect.logLabel !== undefined || effect.logValue !== undefined) {
          writer(effect.logLabel, effect.logValue);
        }

        return effect.update;
      });
    })
  );
}

export function createStorageEffectExecutor({ setStorage, log } = {}) {
  return function executeEffects(effects) {
    return executeStorageEffects(effects, { setStorage, log });
  };
}