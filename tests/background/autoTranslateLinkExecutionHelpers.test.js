import { describe, expect, it, vi } from "vitest";
import {
  executeActiveTabTranslationBootstrap,
  executeAutoTranslateDomEffects,
  executeQueriedActiveTabTranslationBootstrap,
} from "../../src/background/autoTranslateLinkExecutionHelpers.js";

describe("autoTranslateLinkExecutionHelpers", () => {
  it("bootstraps active-tab translation state from the queried main-frame response", async () => {
    const sendTabMessage = vi.fn((tabId, payload, options, callback) => {
      callback("translated");
    });
    const setActiveTabTranslationInfo = vi.fn();
    const afterSend = vi.fn();

    await expect(
      executeActiveTabTranslationBootstrap(
        {
          id: 18,
          url: "https://example.com/start",
          active: true,
        },
        {
          setActiveTabTranslationInfo,
          sendTabMessage,
          afterSend,
        }
      )
    ).resolves.toEqual({
      tabId: 18,
      pageLanguageState: "translated",
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
        pageLanguageState: "translated",
        url: "https://example.com/start",
      }],
    ]);
    expect(sendTabMessage).toHaveBeenCalledWith(
      18,
      { action: "getCurrentPageLanguageState" },
      { frameId: 0 },
      expect.any(Function)
    );
    expect(afterSend).toHaveBeenCalledTimes(1);
  });

  it("skips active-tab bootstrap when the tab or send handler is missing", async () => {
    const setActiveTabTranslationInfo = vi.fn();

    await expect(
      executeActiveTabTranslationBootstrap(null, {
        setActiveTabTranslationInfo,
      })
    ).resolves.toBeNull();

    await expect(
      executeActiveTabTranslationBootstrap(
        {
          id: 18,
          url: "https://example.com/start",
        },
        {
          setActiveTabTranslationInfo,
        }
      )
    ).resolves.toBeNull();

    expect(setActiveTabTranslationInfo).not.toHaveBeenCalled();
  });

  it("queries the active tab before bootstrapping translation state", async () => {
    const queryTabs = vi.fn((queryInfo, callback) => {
      callback([
        {
          id: 18,
          url: "https://example.com/start",
          active: true,
        },
      ]);
    });
    const sendTabMessage = vi.fn((tabId, payload, options, callback) => {
      callback("translated");
    });
    const setActiveTabTranslationInfo = vi.fn();
    const afterSend = vi.fn();

    await expect(
      executeQueriedActiveTabTranslationBootstrap({
        queryTabs,
        setActiveTabTranslationInfo,
        sendTabMessage,
        afterSend,
      })
    ).resolves.toEqual({
      tabId: 18,
      pageLanguageState: "translated",
      url: "https://example.com/start",
    });

    expect(queryTabs).toHaveBeenCalledWith(
      {
        active: true,
        currentWindow: true,
      },
      expect.any(Function)
    );
    expect(setActiveTabTranslationInfo.mock.calls).toEqual([
      [{
        tabId: 18,
        pageLanguageState: "original",
        url: "https://example.com/start",
      }],
      [{
        tabId: 18,
        pageLanguageState: "translated",
        url: "https://example.com/start",
      }],
    ]);
  });

  it("dispatches storage writes and alarm creation in order", async () => {
    const setStorage = vi.fn(async () => undefined);
    const createAlarm = vi.fn();

    await executeAutoTranslateDomEffects([
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
    ], {
      setStorage,
      createAlarm,
    });

    expect(setStorage).toHaveBeenCalledWith({
      tabToAutoTranslate: 18,
    });
    expect(createAlarm).toHaveBeenCalledWith("alarmAutoTranslate", {
      delayInMinutes: 0.01,
    });
  });

  it("ignores unsupported effects and missing handlers", async () => {
    await expect(
      executeAutoTranslateDomEffects([
        { type: "noop" },
        { type: "create-alarm", name: "alarmAutoTranslate", alarmInfo: { delayInMinutes: 0.01 } },
      ])
    ).resolves.toBeUndefined();

    await expect(executeQueriedActiveTabTranslationBootstrap()).resolves.toBeNull();
  });
});