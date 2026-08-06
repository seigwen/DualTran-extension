import { describe, expect, it, vi } from "vitest";
import {
  buildAutoTranslateDomExecutionPlan,
  buildSitesToAutoTranslateOnCommitted,
  buildSitesToAutoTranslateRemoval,
  resolveActiveTabTranslationInfoMessageUpdate,
  resolveActiveTabTranslationQueryResponse,
  resolveAutoTranslateOnDOMContentLoaded,
} from "../../src/background/autoTranslateLinkHelpers.js";
import { executeQueriedActiveTabTranslationBootstrap } from "../../src/background/autoTranslateLinkExecutionHelpers.js";

describe("active tab translation runtime flow integration", () => {
  it("combines activation bootstrap, runtime translation updates, and same-host auto-translate scheduling", async () => {
    const sendTabMessage = vi.fn((tabId, payload, options, callback) => {
      callback("original");
    });
    const tab = {
      id: 18,
      url: "https://example.com/start",
      active: true,
    };

    const setActiveTabTranslationInfo = vi.fn();

    await expect(
      executeQueriedActiveTabTranslationBootstrap({
        queryTabs(_queryInfo, callback) {
          callback([tab]);
        },
        setActiveTabTranslationInfo,
        sendTabMessage,
      })
    ).resolves.toEqual({
      tabId: 18,
      pageLanguageState: "original",
      url: "https://example.com/start",
    });

    expect(setActiveTabTranslationInfo.mock.calls).toEqual([
      [{
        tabId: 18,
        pageLanguageState: "original",
        url: "https://example.com/start",
      }],
      [{
        tabId: 18,
        pageLanguageState: "original",
        url: "https://example.com/start",
      }],
    ]);

    let activeTabTranslationInfo = setActiveTabTranslationInfo.mock.calls.at(-1)[0];

    const runtimeUpdate = resolveActiveTabTranslationInfoMessageUpdate(
      {
        action: "setPageLanguageState",
        pageLanguageState: "translated",
      },
      { tab }
    );

    expect(runtimeUpdate).toEqual({
      tabId: 18,
      pageLanguageState: "translated",
      url: "https://example.com/start",
    });
    activeTabTranslationInfo = runtimeUpdate;

    const rememberedSites = buildSitesToAutoTranslateOnCommitted({}, activeTabTranslationInfo, {
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

    expect(buildSitesToAutoTranslateRemoval(domResult.nextSitesToAutoTranslate, 18)).toEqual({});
    expect(sendTabMessage).toHaveBeenCalledWith(
      18,
      { action: "getCurrentPageLanguageState" },
      { frameId: 0 },
      expect.any(Function)
    );
  });

  it("does not remember same-host links until runtime updates mark the active tab as translated", () => {
    const tab = {
      id: 9,
      url: "https://example.com/start",
      active: true,
    };
    const originalInfo = resolveActiveTabTranslationQueryResponse(tab, "original");

    expect(buildSitesToAutoTranslateOnCommitted({}, originalInfo, {
      tabId: 9,
      frameId: 0,
      transitionType: "link",
      url: "https://example.com/next",
    })).toEqual({});

    const translatedInfo = resolveActiveTabTranslationInfoMessageUpdate(
      {
        action: "setPageLanguageState",
        pageLanguageState: "translated",
      },
      { tab }
    );

    expect(buildSitesToAutoTranslateOnCommitted({}, translatedInfo, {
      tabId: 9,
      frameId: 0,
      transitionType: "link",
      url: "https://example.com/next",
    })).toEqual({
      9: "example.com",
    });
  });
});