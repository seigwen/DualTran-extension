import { describe, expect, it } from "vitest";
import {
  buildActiveTabTranslationBootstrap,
  buildSitesToAutoTranslateOnCommitted,
  buildSitesToAutoTranslateRemoval,
  resolveActiveTabTranslationQueryResponse,
  resolveAutoTranslateOnDOMContentLoaded,
  buildAutoTranslateDomExecutionPlan,
} from "../../src/background/autoTranslateLinkHelpers.js";

describe("auto-translate link flow integration", () => {
  it("combines active-tab bootstrap, query-response writeback, and same-host link remembering", () => {
    const bootstrap = buildActiveTabTranslationBootstrap({
      id: 18,
      url: "https://example.com/start",
    });

    expect(bootstrap).toEqual({
      initialActiveTabTranslationInfo: {
        tabId: 18,
        pageLanguageState: "original",
        url: "https://example.com/start",
      },
      query: {
        tabId: 18,
        message: {
          action: "getCurrentPageLanguageState",
        },
        options: {
          frameId: 0,
        },
      },
    });

    const activeTabTranslationInfo = resolveActiveTabTranslationQueryResponse(
      { id: 18, url: "https://example.com/start" },
      "translated"
    );

    expect(buildSitesToAutoTranslateOnCommitted({}, activeTabTranslationInfo, {
      tabId: 18,
      frameId: 0,
      transitionType: "link",
      url: "https://example.com/next",
    })).toEqual({
      18: "example.com",
    });
  });

  it("combines remembered-site dispatch, DOMContentLoaded scheduling, and cleanup removal", () => {
    const domPlan = resolveAutoTranslateOnDOMContentLoaded(
      {
        18: "example.com",
        19: "other.example.com",
      },
      {
        tabId: 18,
        frameId: 0,
        url: "https://example.com/next",
      }
    );

    expect(buildAutoTranslateDomExecutionPlan(domPlan)).toEqual([
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

    expect(buildSitesToAutoTranslateRemoval(domPlan.nextSitesToAutoTranslate, 19)).toEqual({});
  });
});