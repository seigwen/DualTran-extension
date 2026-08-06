import { describe, expect, it, vi } from "vitest";
import {
  buildAutoTranslateListenerEffects,
  buildDisableAutoTranslateExecutionPlan,
  buildEnableAutoTranslateExecutionPlan,
  createAutoTranslateListenerEffectExecutor,
  createAutoTranslateListenerInvoker,
  executeAutoTranslateListenerEffects,
  MISSING_WEB_NAVIGATION_MESSAGE,
} from "../../src/background/autoTranslateListenerExecutionHelpers.js";

describe("autoTranslateListenerExecutionHelpers", () => {
  it("maps listener entries into executable listener-call effects", () => {
    expect(buildAutoTranslateListenerEffects([
      { target: "tabs.onActivated", method: "addListener", listener: "tabsOnActivated" },
      { target: "runtime.onMessage", method: "removeListener", listener: "runtimeOnMessage" },
    ])).toEqual([
      { type: "listener-call", target: "tabs.onActivated", method: "addListener", listener: "tabsOnActivated" },
      { type: "listener-call", target: "runtime.onMessage", method: "removeListener", listener: "runtimeOnMessage" },
    ]);
  });

  it("builds enable execution effects only when the listener plan should proceed", () => {
    expect(buildEnableAutoTranslateExecutionPlan({
      shouldProceed: true,
      addListeners: [
        { target: "tabs.onActivated", method: "addListener", listener: "tabsOnActivated" },
        { target: "webNavigation.onCommitted", method: "addListener", listener: "webNavigationOnCommitted" },
      ],
    })).toEqual([
      { type: "listener-call", target: "tabs.onActivated", method: "addListener", listener: "tabsOnActivated" },
      { type: "listener-call", target: "webNavigation.onCommitted", method: "addListener", listener: "webNavigationOnCommitted" },
    ]);

    expect(buildEnableAutoTranslateExecutionPlan({
      shouldProceed: false,
      addListeners: [
        { target: "tabs.onActivated", method: "addListener", listener: "tabsOnActivated" },
      ],
    })).toEqual([]);
  });

  it("builds disable execution effects with reset-state, listener removals, and missing-permission logging", () => {
    expect(buildDisableAutoTranslateExecutionPlan({
      plan: {
        shouldResetState: true,
        removeListeners: [
          { target: "tabs.onActivated", method: "removeListener", listener: "tabsOnActivated" },
          { target: "runtime.onMessage", method: "removeListener", listener: "runtimeOnMessage" },
        ],
        shouldLogMissingWebNavigation: true,
      },
      resetState: {
        activeTabTranslationInfo: {},
        sitesToAutoTranslate: {},
      },
    })).toEqual([
      {
        type: "reset-state",
        resetState: {
          activeTabTranslationInfo: {},
          sitesToAutoTranslate: {},
        },
      },
      { type: "listener-call", target: "tabs.onActivated", method: "removeListener", listener: "tabsOnActivated" },
      { type: "listener-call", target: "runtime.onMessage", method: "removeListener", listener: "runtimeOnMessage" },
      { type: "log-info", message: MISSING_WEB_NAVIGATION_MESSAGE },
    ]);
  });

  it("omits reset-state and logging when the disable plan does not require them", () => {
    expect(buildDisableAutoTranslateExecutionPlan({
      plan: {
        shouldResetState: false,
        removeListeners: [
          { target: "tabs.onRemoved", method: "removeListener", listener: "tabsOnRemoved" },
        ],
        shouldLogMissingWebNavigation: false,
      },
      resetState: {
        activeTabTranslationInfo: { a: 1 },
        sitesToAutoTranslate: { b: 2 },
      },
    })).toEqual([
      { type: "listener-call", target: "tabs.onRemoved", method: "removeListener", listener: "tabsOnRemoved" },
    ]);
  });

  it("executes reset-state, listener-call, and log-info effects", () => {
    const setActiveTabTranslationInfo = vi.fn();
    const setSitesToAutoTranslate = vi.fn();
    const invokeListener = vi.fn();
    const logInfo = vi.fn();

    executeAutoTranslateListenerEffects([
      {
        type: "reset-state",
        resetState: {
          activeTabTranslationInfo: {},
          sitesToAutoTranslate: {},
        },
      },
      {
        type: "listener-call",
        target: "tabs.onActivated",
        method: "addListener",
        listener: "tabsOnActivated",
      },
      {
        type: "log-info",
        message: MISSING_WEB_NAVIGATION_MESSAGE,
      },
    ], {
      setActiveTabTranslationInfo,
      setSitesToAutoTranslate,
      invokeListener,
      logInfo,
    });

    expect(setActiveTabTranslationInfo).toHaveBeenCalledWith({});
    expect(setSitesToAutoTranslate).toHaveBeenCalledWith({});
    expect(invokeListener).toHaveBeenCalledWith("tabs.onActivated", "addListener", "tabsOnActivated");
    expect(logInfo).toHaveBeenCalledWith(MISSING_WEB_NAVIGATION_MESSAGE);
  });

  it("creates a listener effect executor that binds reset-state, listener, and log handlers", () => {
    const setActiveTabTranslationInfo = vi.fn();
    const setSitesToAutoTranslate = vi.fn();
    const invokeListener = vi.fn();
    const logInfo = vi.fn();

    const executeEffects = createAutoTranslateListenerEffectExecutor({
      setActiveTabTranslationInfo,
      setSitesToAutoTranslate,
      invokeListener,
      logInfo,
    });

    executeEffects([
      {
        type: "reset-state",
        resetState: {
          activeTabTranslationInfo: { tabId: 3 },
          sitesToAutoTranslate: { 3: "example.com" },
        },
      },
      {
        type: "listener-call",
        target: "tabs.onActivated",
        method: "addListener",
        listener: "tabsOnActivated",
      },
      {
        type: "log-info",
        message: MISSING_WEB_NAVIGATION_MESSAGE,
      },
    ]);

    expect(setActiveTabTranslationInfo).toHaveBeenCalledWith({ tabId: 3 });
    expect(setSitesToAutoTranslate).toHaveBeenCalledWith({ 3: "example.com" });
    expect(invokeListener).toHaveBeenCalledWith("tabs.onActivated", "addListener", "tabsOnActivated");
    expect(logInfo).toHaveBeenCalledWith(MISSING_WEB_NAVIGATION_MESSAGE);
  });

  it("creates an invoker that routes named listeners to the matching chrome listener api", () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    const tabsOnActivated = vi.fn();

    const invokeListener = createAutoTranslateListenerInvoker({
      listenerApis: {
        "tabs.onActivated": { addListener, removeListener },
      },
      listeners: {
        tabsOnActivated,
      },
    });

    invokeListener("tabs.onActivated", "addListener", "tabsOnActivated");
    invokeListener("tabs.onActivated", "removeListener", "tabsOnActivated");

    expect(addListener).toHaveBeenCalledWith(tabsOnActivated);
    expect(removeListener).toHaveBeenCalledWith(tabsOnActivated);
  });

  it("ignores unknown listener targets, methods, and listener names", () => {
    const addListener = vi.fn();

    const invokeListener = createAutoTranslateListenerInvoker({
      listenerApis: {
        "tabs.onActivated": { addListener },
      },
      listeners: {
        tabsOnActivated: vi.fn(),
      },
    });

    invokeListener("runtime.onMessage", "addListener", "tabsOnActivated");
    invokeListener("tabs.onActivated", "removeListener", "tabsOnActivated");
    invokeListener("tabs.onActivated", "addListener", "runtimeOnMessage");

    expect(addListener).not.toHaveBeenCalled();
  });
});