"use strict";

export function buildEnableAutoTranslateListenerPlan(hasWebNavigation) {
  return {
    shouldDisableFirst: true,
    shouldProceed: Boolean(hasWebNavigation),
    addListeners: hasWebNavigation
      ? [
          { target: "tabs.onActivated", method: "addListener", listener: "tabsOnActivated" },
          { target: "tabs.onRemoved", method: "addListener", listener: "tabsOnRemoved" },
          { target: "runtime.onMessage", method: "addListener", listener: "runtimeOnMessage" },
          { target: "webNavigation.onCommitted", method: "addListener", listener: "webNavigationOnCommitted" },
          { target: "webNavigation.onDOMContentLoaded", method: "addListener", listener: "webNavigationOnDOMContentLoaded" },
        ]
      : [],
  };
}

export function buildDisableAutoTranslateListenerPlan(hasWebNavigation) {
  const removeListeners = [
    { target: "tabs.onActivated", method: "removeListener", listener: "tabsOnActivated" },
    { target: "tabs.onRemoved", method: "removeListener", listener: "tabsOnRemoved" },
    { target: "runtime.onMessage", method: "removeListener", listener: "runtimeOnMessage" },
  ];

  if (hasWebNavigation) {
    removeListeners.push(
      { target: "webNavigation.onCommitted", method: "removeListener", listener: "webNavigationOnCommitted" },
      { target: "webNavigation.onDOMContentLoaded", method: "removeListener", listener: "webNavigationOnDOMContentLoaded" }
    );
  }

  return {
    shouldResetState: true,
    removeListeners,
    shouldLogMissingWebNavigation: !hasWebNavigation,
  };
}