import { describe, expect, it } from "vitest";
import {
  buildDisableAutoTranslateListenerPlan,
  buildEnableAutoTranslateListenerPlan,
} from "../../src/background/autoTranslateListenerHelpers.js";
import {
  buildDisableAutoTranslateExecutionPlan,
  buildEnableAutoTranslateExecutionPlan,
  MISSING_WEB_NAVIGATION_MESSAGE,
} from "../../src/background/autoTranslateListenerExecutionHelpers.js";

describe("auto-translate listener flow integration", () => {
  it("combines enable listener planning with listener-call execution effects", () => {
    const plan = buildEnableAutoTranslateListenerPlan(true);

    expect(buildEnableAutoTranslateExecutionPlan(plan)).toEqual([
      { type: "listener-call", target: "tabs.onActivated", method: "addListener", listener: "tabsOnActivated" },
      { type: "listener-call", target: "tabs.onRemoved", method: "addListener", listener: "tabsOnRemoved" },
      { type: "listener-call", target: "runtime.onMessage", method: "addListener", listener: "runtimeOnMessage" },
      { type: "listener-call", target: "webNavigation.onCommitted", method: "addListener", listener: "webNavigationOnCommitted" },
      { type: "listener-call", target: "webNavigation.onDOMContentLoaded", method: "addListener", listener: "webNavigationOnDOMContentLoaded" },
    ]);
  });

  it("combines disable listener planning with reset-state, remove-listener, and missing-permission log effects", () => {
    const plan = buildDisableAutoTranslateListenerPlan(false);

    expect(buildDisableAutoTranslateExecutionPlan({
      plan,
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
      { type: "listener-call", target: "tabs.onRemoved", method: "removeListener", listener: "tabsOnRemoved" },
      { type: "listener-call", target: "runtime.onMessage", method: "removeListener", listener: "runtimeOnMessage" },
      { type: "log-info", message: MISSING_WEB_NAVIGATION_MESSAGE },
    ]);
  });
});