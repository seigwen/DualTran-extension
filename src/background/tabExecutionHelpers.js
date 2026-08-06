"use strict";

export function executeTabEffects(effects, {
  createTab,
  sendTabMessage,
  reloadTab,
  sendMessageCallback,
} = {}) {
  (effects || []).forEach((effect) => {
    if (effect?.type === "open-tab" && typeof createTab === "function") {
      createTab({ url: effect.url });
    } else if (effect?.type === "reload-tab" && typeof reloadTab === "function") {
      reloadTab(effect.tabId);
    } else if (effect?.type === "send-tab-message" && typeof sendTabMessage === "function") {
      if (effect.options !== undefined && sendMessageCallback) {
        sendTabMessage(effect.tabId, effect.message, effect.options, sendMessageCallback);
      } else if (effect.options !== undefined) {
        sendTabMessage(effect.tabId, effect.message, effect.options);
      } else if (sendMessageCallback) {
        sendTabMessage(effect.tabId, effect.message, sendMessageCallback);
      } else {
        sendTabMessage(effect.tabId, effect.message);
      }
    }
  });
}

export function createTabEffectExecutor({
  createTab,
  sendTabMessage,
  reloadTab,
  sendMessageCallback,
} = {}) {
  return function executeEffects(effects) {
    executeTabEffects(effects, {
      createTab,
      sendTabMessage,
      reloadTab,
      sendMessageCallback,
    });
  };
}