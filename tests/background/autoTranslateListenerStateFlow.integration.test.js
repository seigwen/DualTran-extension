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

describe("auto-translate listener state flow integration", () => {
  it("combines listener enablement with runtime-driven auto-translate state progression and disable reset", async () => {
    const sendTabMessage = vi.fn((tabId, payload, options, callback) => {
      callback("original");
    });

    const enablePlan = buildEnableAutoTranslateListenerPlan(true);
    expect(buildEnableAutoTranslateExecutionPlan(enablePlan)).toEqual([
      { type: "listener-call", target: "tabs.onActivated", method: "addListener", listener: "tabsOnActivated" },
      { type: "listener-call", target: "tabs.onRemoved", method: "addListener", listener: "tabsOnRemoved" },
      { type: "listener-call", target: "runtime.onMessage", method: "addListener", listener: "runtimeOnMessage" },
      { type: "listener-call", target: "webNavigation.onCommitted", method: "addListener", listener: "webNavigationOnCommitted" },
      { type: "listener-call", target: "webNavigation.onDOMContentLoaded", method: "addListener", listener: "webNavigationOnDOMContentLoaded" },
    ]);

    const bootstrap = buildActiveTabTranslationBootstrap({
      id: 18,
      url: "https://example.com/start",
      active: true,
    });

    const queriedState = await queryMainFrame(
      bootstrap.query.tabId,
      bootstrap.query.message.action,
      sendTabMessage
    );

    const activeTabTranslationInfo = resolveActiveTabTranslationQueryResponse(
      { id: 18, url: "https://example.com/start", active: true },
      queriedState
    );

    expect(activeTabTranslationInfo).toEqual({
      tabId: 18,
      pageLanguageState: "original",
      url: "https://example.com/start",
    });

    const translatedInfo = resolveActiveTabTranslationInfoMessageUpdate(
      {
        action: "setPageLanguageState",
        pageLanguageState: "translated",
      },
      {
        tab: {
          id: 18,
          url: "https://example.com/start",
          active: true,
        },
      }
    );

    const rememberedSites = buildSitesToAutoTranslateOnCommitted({}, translatedInfo, {
      tabId: 18,
      frameId: 0,
      transitionType: "link",
      url: "https://example.com/next",
    });

    expect(rememberedSites).toEqual({
      18: "example.com",
    });

    const domResult = resolveAutoTranslateOnDOMContentLoaded(rememberedSites, {
      tabId: 18,
      frameId: 0,
      url: "https://example.com/next",
    });

    expect(buildAutoTranslateDomExecutionPlan(domResult)).toEqual([
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

    const disablePlan = buildDisableAutoTranslateListenerPlan(true);
    expect(buildDisableAutoTranslateExecutionPlan({
      plan: disablePlan,
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
      { type: "listener-call", target: "webNavigation.onCommitted", method: "removeListener", listener: "webNavigationOnCommitted" },
      { type: "listener-call", target: "webNavigation.onDOMContentLoaded", method: "removeListener", listener: "webNavigationOnDOMContentLoaded" },
    ]);
  });
});