import { describe, expect, it, vi } from "vitest";
import { queryMainFrame } from "../../src/background/runtimeMessageHelpers.js";
import { buildDisableAutoTranslateListenerPlan, buildEnableAutoTranslateListenerPlan } from "../../src/background/autoTranslateListenerHelpers.js";
import { buildDisableAutoTranslateExecutionPlan, buildEnableAutoTranslateExecutionPlan } from "../../src/background/autoTranslateListenerExecutionHelpers.js";
import {
  buildActiveTabTranslationBootstrap,
  buildAutoTranslateDomExecutionPlan,
  buildSitesToAutoTranslateOnCommitted,
  resolveActiveTabTranslationInfoMessageUpdate,
  resolveActiveTabTranslationQueryResponse,
  resolveAutoTranslateOnDOMContentLoaded,
} from "../../src/background/autoTranslateLinkHelpers.js";
import { buildAutoTranslateResetState, resolveAutoTranslateConfigChange } from "../../src/background/autoTranslateRuntimeHelpers.js";
import { buildAutoTranslateConfigToggleEffects } from "../../src/background/autoTranslateRuntimeExecutionHelpers.js";

describe("auto-translate config state flow integration", () => {
  it("combines config enable toggles with listener enablement and runtime auto-translate progression", async () => {
    const sendTabMessage = vi.fn((tabId, payload, options, callback) => {
      callback("original");
    });
    const tab = {
      id: 18,
      url: "https://example.com/start",
      active: true,
    };

    expect(buildAutoTranslateConfigToggleEffects(
      resolveAutoTranslateConfigChange("autoTranslateWhenClickingALink", "yes")
    )).toEqual([
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

    const bootstrap = buildActiveTabTranslationBootstrap(tab);
    const queriedState = await queryMainFrame(
      bootstrap.query.tabId,
      bootstrap.query.message.action,
      sendTabMessage
    );
    const translatedInfo = resolveActiveTabTranslationInfoMessageUpdate(
      {
        action: "setPageLanguageState",
        pageLanguageState: "translated",
      },
      { tab }
    );

    expect(resolveActiveTabTranslationQueryResponse(tab, queriedState)).toEqual({
      tabId: 18,
      pageLanguageState: "original",
      url: "https://example.com/start",
    });

    const rememberedSites = buildSitesToAutoTranslateOnCommitted({}, translatedInfo, {
      tabId: 18,
      frameId: 0,
      transitionType: "link",
      url: "https://example.com/next",
    });

    expect(buildAutoTranslateDomExecutionPlan(
      resolveAutoTranslateOnDOMContentLoaded(rememberedSites, {
        tabId: 18,
        frameId: 0,
        url: "https://example.com/next",
      })
    )).toEqual([
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
  });

  it("combines config disable toggles with listener teardown and state reset", () => {
    expect(buildAutoTranslateConfigToggleEffects(
      resolveAutoTranslateConfigChange("autoTranslateWhenClickingALink", "no")
    )).toEqual([
      {
        type: "toggle-auto-translate",
        action: "disable",
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