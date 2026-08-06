import { describe, expect, it } from "vitest";
import {
  buildDisableAutoTranslateListenerPlan,
  buildEnableAutoTranslateListenerPlan,
} from "../../src/background/autoTranslateListenerHelpers.js";
import {
  buildDisableAutoTranslateExecutionPlan,
  buildEnableAutoTranslateExecutionPlan,
} from "../../src/background/autoTranslateListenerExecutionHelpers.js";
import {
  buildAutoTranslateResetState,
  resolveAutoTranslatePermissionBootstrap,
  shouldDisableAutoTranslateForRemovedPermissions,
} from "../../src/background/autoTranslateRuntimeHelpers.js";
import {
  buildAutoTranslatePermissionBootstrapEffects,
  buildAutoTranslatePermissionRemovedEffects,
} from "../../src/background/autoTranslateRuntimeExecutionHelpers.js";

describe("auto-translate permission state flow integration", () => {
  it("combines permission bootstrap enablement with listener activation", () => {
    const bootstrap = resolveAutoTranslatePermissionBootstrap({
      hasPermissions: true,
      autoTranslateWhenClickingALink: "yes",
    });

    expect(buildAutoTranslatePermissionBootstrapEffects(bootstrap)).toEqual([
      {
        type: "toggle-auto-translate",
        action: "enable",
      },
    ]);

    expect(buildEnableAutoTranslateExecutionPlan(
      buildEnableAutoTranslateListenerPlan(true)
    )).toEqual([
      { type: "listener-call", target: "tabs.onActivated", method: "addListener", listener: "tabsOnActivated" },
      { type: "listener-call", target: "tabs.onRemoved", method: "addListener", listener: "tabsOnRemoved" },
      { type: "listener-call", target: "runtime.onMessage", method: "addListener", listener: "runtimeOnMessage" },
      { type: "listener-call", target: "webNavigation.onCommitted", method: "addListener", listener: "webNavigationOnCommitted" },
      { type: "listener-call", target: "webNavigation.onDOMContentLoaded", method: "addListener", listener: "webNavigationOnDOMContentLoaded" },
    ]);
  });

  it("combines missing bootstrap permissions and removed permissions with disable-side cleanup", () => {
    expect(buildAutoTranslatePermissionBootstrapEffects(
      resolveAutoTranslatePermissionBootstrap({
        hasPermissions: false,
        autoTranslateWhenClickingALink: "yes",
      })
    )).toEqual([
      {
        type: "set-config",
        key: "autoTranslateWhenClickingALink",
        value: "no",
      },
    ]);

    expect(buildAutoTranslatePermissionRemovedEffects(
      shouldDisableAutoTranslateForRemovedPermissions({
        permissions: ["tabs", "webNavigation"],
      })
    )).toEqual([
      {
        type: "set-config",
        key: "autoTranslateWhenClickingALink",
        value: "no",
      },
    ]);

    expect(buildDisableAutoTranslateExecutionPlan({
      plan: buildDisableAutoTranslateListenerPlan(true),
      resetState: buildAutoTranslateResetState(),
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
      { type: "listener-call", target: "webNavigation.onCommitted", method: "removeListener", listener: "webNavigationOnCommitted" },
      { type: "listener-call", target: "webNavigation.onDOMContentLoaded", method: "removeListener", listener: "webNavigationOnDOMContentLoaded" },
    ]);
  });
});