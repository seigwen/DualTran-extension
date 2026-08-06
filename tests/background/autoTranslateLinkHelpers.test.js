import { describe, expect, it } from "vitest";
import {
  buildActiveTabTranslationBootstrap,
  buildActiveTabTranslationInfo,
  buildAutoTranslateDomExecutionPlan,
  buildSitesToAutoTranslateRemoval,
  buildSitesToAutoTranslateOnCommitted,
  resolveActiveTabTranslationInfoMessageUpdate,
  resolveActiveTabTranslationQueryResponse,
  resolveAutoTranslateOnDOMContentLoaded,
} from "../../src/background/autoTranslateLinkHelpers.js";

describe("autoTranslateLinkHelpers", () => {
  it("builds active tab translation info from a tab and page language state", () => {
    expect(
      buildActiveTabTranslationInfo(
        {
          id: 18,
          url: "https://example.com/docs",
        },
        "translated"
      )
    ).toEqual({
      tabId: 18,
      pageLanguageState: "translated",
      url: "https://example.com/docs",
    });

    expect(buildActiveTabTranslationBootstrap({
      id: 18,
      url: "https://example.com/docs",
    })).toEqual({
      initialActiveTabTranslationInfo: {
        tabId: 18,
        pageLanguageState: "original",
        url: "https://example.com/docs",
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

    expect(resolveActiveTabTranslationQueryResponse({
      id: 18,
      url: "https://example.com/docs",
    }, "translated")).toEqual({
      tabId: 18,
      pageLanguageState: "translated",
      url: "https://example.com/docs",
    });

    expect(buildActiveTabTranslationBootstrap(null)).toBeNull();
    expect(resolveActiveTabTranslationQueryResponse(null, "translated")).toBeNull();
  });

  it("updates active tab translation info only for active setPageLanguageState messages", () => {
    expect(
      resolveActiveTabTranslationInfoMessageUpdate(
        {
          action: "setPageLanguageState",
          pageLanguageState: "translated",
        },
        {
          tab: {
            id: 18,
            url: "https://example.com/docs",
            active: true,
          },
        }
      )
    ).toEqual({
      tabId: 18,
      pageLanguageState: "translated",
      url: "https://example.com/docs",
    });

    expect(
      resolveActiveTabTranslationInfoMessageUpdate(
        {
          action: "setPageLanguageState",
          pageLanguageState: "translated",
        },
        {
          tab: {
            id: 18,
            url: "https://example.com/docs",
            active: false,
          },
        }
      )
    ).toBeNull();
  });

  it("remembers same-host link navigations only when the active tab is translated", () => {
    expect(
      buildSitesToAutoTranslateOnCommitted(
        {},
        {
          tabId: 8,
          pageLanguageState: "translated",
          url: "https://example.com/start",
        },
        {
          tabId: 18,
          frameId: 0,
          transitionType: "link",
          url: "https://example.com/next",
        }
      )
    ).toEqual({
      18: "example.com",
    });

    expect(
      buildSitesToAutoTranslateOnCommitted(
        { 18: "example.com" },
        {
          tabId: 8,
          pageLanguageState: "original",
          url: "https://example.com/start",
        },
        {
          tabId: 18,
          frameId: 0,
          transitionType: "reload",
          url: "https://other.example.com/next",
        }
      )
    ).toEqual({});
  });

  it("removes tab-scoped remembered auto-translate hosts when a tab closes", () => {
    expect(buildSitesToAutoTranslateRemoval({
      18: "example.com",
      19: "other.example.com",
    }, 18)).toEqual({
      19: "other.example.com",
    });
  });

  it("schedules auto-translation on matching top-level DOMContentLoaded and clears the remembered host", () => {
    const result = resolveAutoTranslateOnDOMContentLoaded(
      {
        18: "example.com",
        19: "other.example.com",
      },
      {
        tabId: 18,
        frameId: 0,
        url: "https://example.com/next",
      }
    )

    expect(result).toEqual({
      shouldSchedule: true,
      tabId: 18,
      nextSitesToAutoTranslate: {
        19: "other.example.com",
      },
    });

    expect(buildAutoTranslateDomExecutionPlan(result)).toEqual([
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

  it("skips scheduling for nested frames or host mismatches while still cleaning the finished tab", () => {
    expect(
      resolveAutoTranslateOnDOMContentLoaded(
        {
          18: "example.com",
        },
        {
          tabId: 18,
          frameId: 2,
          url: "https://example.com/next",
        }
      )
    ).toEqual({
      shouldSchedule: false,
      nextSitesToAutoTranslate: {
        18: "example.com",
      },
    });

    expect(
      resolveAutoTranslateOnDOMContentLoaded(
        {
          18: "example.com",
        },
        {
          tabId: 18,
          frameId: 0,
          url: "https://other.example.com/next",
        }
      )
    ).toEqual({
      shouldSchedule: false,
      tabId: 18,
      nextSitesToAutoTranslate: {},
    });

    expect(buildAutoTranslateDomExecutionPlan({
      shouldSchedule: false,
      nextSitesToAutoTranslate: {},
    })).toEqual([]);
  });
});