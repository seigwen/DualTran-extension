import { describe, expect, it, vi } from "vitest";
import { queryMainFrame } from "../../src/background/runtimeMessageHelpers.js";
import {
  buildDisableAutoTranslateListenerPlan,
  buildEnableAutoTranslateListenerPlan,
} from "../../src/background/autoTranslateListenerHelpers.js";
import {
  buildDisableAutoTranslateExecutionPlan,
  buildEnableAutoTranslateExecutionPlan,
} from "../../src/background/autoTranslateListenerExecutionHelpers.js";
import {
  buildActiveTabTranslationBootstrap,
  buildAutoTranslateDomExecutionPlan,
  buildSitesToAutoTranslateOnCommitted,
  resolveActiveTabTranslationInfoMessageUpdate,
  resolveActiveTabTranslationQueryResponse,
  resolveAutoTranslateOnDOMContentLoaded,
} from "../../src/background/autoTranslateLinkHelpers.js";
import {
  buildAutoTranslateResetState,
  resolveAutoTranslateAlarmDispatch,
  resolveAutoTranslateConfigChange,
  resolveAutoTranslatePermissionBootstrap,
  shouldDisableAutoTranslateForRemovedPermissions,
} from "../../src/background/autoTranslateRuntimeHelpers.js";
import {
  buildAutoTranslateAlarmExecutionPlan,
  buildAutoTranslateConfigToggleEffects,
  buildAutoTranslatePermissionBootstrapEffects,
  buildAutoTranslatePermissionRemovedEffects,
} from "../../src/background/autoTranslateRuntimeExecutionHelpers.js";

describe("auto-translate lifecycle integration", () => {
  it("walks the full happy path from permission/bootstrap to alarm dispatch and cleanup", async () => {
    const sendTabMessage = vi.fn((tabId, payload, options, callback) => {
      callback("original");
    });
    const activeTab = {
      id: 18,
      url: "https://example.com/start",
      active: true,
    };

    expect(buildAutoTranslatePermissionBootstrapEffects(
      resolveAutoTranslatePermissionBootstrap({
        hasPermissions: true,
        autoTranslateWhenClickingALink: "yes",
      })
    )).toEqual([
      { type: "toggle-auto-translate", action: "enable" },
    ]);

    expect(buildAutoTranslateConfigToggleEffects(
      resolveAutoTranslateConfigChange("autoTranslateWhenClickingALink", "yes")
    )).toEqual([
      { type: "toggle-auto-translate", action: "enable" },
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

    const bootstrap = buildActiveTabTranslationBootstrap(activeTab);
    const initialState = await queryMainFrame(
      bootstrap.query.tabId,
      bootstrap.query.message.action,
      sendTabMessage
    );
    expect(resolveActiveTabTranslationQueryResponse(activeTab, initialState)).toEqual({
      tabId: 18,
      pageLanguageState: "original",
      url: "https://example.com/start",
    });

    const translatedInfo = resolveActiveTabTranslationInfoMessageUpdate(
      {
        action: "setPageLanguageState",
        pageLanguageState: "translated",
      },
      { tab: activeTab }
    );

    const rememberedSites = buildSitesToAutoTranslateOnCommitted({}, translatedInfo, {
      tabId: 18,
      frameId: 0,
      transitionType: "link",
      url: "https://example.com/next",
    });
    expect(rememberedSites).toEqual({ 18: "example.com" });

    const domLoadedPlan = resolveAutoTranslateOnDOMContentLoaded(rememberedSites, {
      tabId: 18,
      frameId: 0,
      url: "https://example.com/next",
    });
    expect(buildAutoTranslateDomExecutionPlan(domLoadedPlan)).toEqual([
      {
        type: "set-storage",
        update: {
          tabToAutoTranslate: 18,
        },
      },
      {
        type: "create-alarm",
        name: "alarmAutoTranslate",
        alarmInfo: {
          delayInMinutes: 0.01,
        },
      },
    ]);

    const alarmDispatch = resolveAutoTranslateAlarmDispatch(
      { name: "alarmAutoTranslate" },
      { tabToAutoTranslate: 18 }
    );
    expect(buildAutoTranslateAlarmExecutionPlan(alarmDispatch)).toEqual([
      {
        type: "send-tab-message",
        tabId: 18,
        message: { action: "autoTranslateBecauseClickedALink" },
        options: { frameId: 0 },
      },
    ]);

    expect(buildAutoTranslatePermissionRemovedEffects(
      shouldDisableAutoTranslateForRemovedPermissions({ permissions: ["webNavigation"] })
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

  it("forces config disable during bootstrap when permissions are unavailable and skips listener activation", () => {
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

    expect(buildEnableAutoTranslateExecutionPlan(
      buildEnableAutoTranslateListenerPlan(false)
    )).toEqual([]);
  });
});