import { describe, expect, it, vi } from "vitest";
import {
  buildDisableAutoTranslateListenerPlan,
  buildEnableAutoTranslateListenerPlan,
} from "../../src/background/autoTranslateListenerHelpers.js";
import {
  buildDisableAutoTranslateExecutionPlan,
  buildEnableAutoTranslateExecutionPlan,
  createAutoTranslateListenerEffectExecutor,
  createAutoTranslateListenerInvoker,
  MISSING_WEB_NAVIGATION_MESSAGE,
} from "../../src/background/autoTranslateListenerExecutionHelpers.js";

describe("auto-translate listener dispatch loop integration", () => {
  it("dispatches enable listener plans through the shared listener executor", () => {
    const addListenerCalls = [];
    const invokeListener = createAutoTranslateListenerInvoker({
      listenerApis: {
        "tabs.onActivated": {
          addListener(listener) {
            addListenerCalls.push(["tabs.onActivated", listener.name]);
          },
        },
        "tabs.onRemoved": {
          addListener(listener) {
            addListenerCalls.push(["tabs.onRemoved", listener.name]);
          },
        },
        "runtime.onMessage": {
          addListener(listener) {
            addListenerCalls.push(["runtime.onMessage", listener.name]);
          },
        },
        "webNavigation.onCommitted": {
          addListener(listener) {
            addListenerCalls.push(["webNavigation.onCommitted", listener.name]);
          },
        },
        "webNavigation.onDOMContentLoaded": {
          addListener(listener) {
            addListenerCalls.push(["webNavigation.onDOMContentLoaded", listener.name]);
          },
        },
      },
      listeners: {
        tabsOnActivated() {},
        tabsOnRemoved() {},
        runtimeOnMessage() {},
        webNavigationOnCommitted() {},
        webNavigationOnDOMContentLoaded() {},
      },
    });

    createAutoTranslateListenerEffectExecutor({ invokeListener })(
      buildEnableAutoTranslateExecutionPlan(buildEnableAutoTranslateListenerPlan(true))
    );

    expect(addListenerCalls).toEqual([
      ["tabs.onActivated", "tabsOnActivated"],
      ["tabs.onRemoved", "tabsOnRemoved"],
      ["runtime.onMessage", "runtimeOnMessage"],
      ["webNavigation.onCommitted", "webNavigationOnCommitted"],
      ["webNavigation.onDOMContentLoaded", "webNavigationOnDOMContentLoaded"],
    ]);
  });

  it("dispatches disable listener plans through reset-state, remove-listener, and log handlers", () => {
    const setActiveTabTranslationInfo = vi.fn();
    const setSitesToAutoTranslate = vi.fn();
    const removeListenerCalls = [];
    const invokeListener = createAutoTranslateListenerInvoker({
      listenerApis: {
        "tabs.onActivated": {
          removeListener(listener) {
            removeListenerCalls.push(["tabs.onActivated", listener.name]);
          },
        },
        "tabs.onRemoved": {
          removeListener(listener) {
            removeListenerCalls.push(["tabs.onRemoved", listener.name]);
          },
        },
        "runtime.onMessage": {
          removeListener(listener) {
            removeListenerCalls.push(["runtime.onMessage", listener.name]);
          },
        },
      },
      listeners: {
        tabsOnActivated() {},
        tabsOnRemoved() {},
        runtimeOnMessage() {},
      },
    });
    const logInfo = vi.fn();

    createAutoTranslateListenerEffectExecutor({
      setActiveTabTranslationInfo,
      setSitesToAutoTranslate,
      invokeListener,
      logInfo,
    })(
      buildDisableAutoTranslateExecutionPlan({
        plan: buildDisableAutoTranslateListenerPlan(false),
        resetState: {
          activeTabTranslationInfo: {},
          sitesToAutoTranslate: {},
        },
      })
    );

    expect(setActiveTabTranslationInfo).toHaveBeenCalledWith({});
    expect(setSitesToAutoTranslate).toHaveBeenCalledWith({});
    expect(removeListenerCalls).toEqual([
      ["tabs.onActivated", "tabsOnActivated"],
      ["tabs.onRemoved", "tabsOnRemoved"],
      ["runtime.onMessage", "runtimeOnMessage"],
    ]);
    expect(logInfo).toHaveBeenCalledWith(MISSING_WEB_NAVIGATION_MESSAGE);
  });
});