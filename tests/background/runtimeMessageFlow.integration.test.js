import { describe, expect, it, vi } from "vitest";
import {
  queryMainFrame,
} from "../../src/background/runtimeMessageHelpers.js";
import {
  buildFrameFocusBroadcastEffect,
  buildOpenDonationPageEffect,
  buildOpenFeedbackIssueEffect,
  buildOpenOptionsPageEffect,
  executeSenderTabHostNameQuery,
  executeSenderTabLanguageQuery,
  executeQueriedActiveTabMimeType,
} from "../../src/background/runtimeMessageExecutionHelpers.js";

describe("runtime message flow integration", () => {
  it("combines main-frame query with follow-up frame-focus broadcast effects", async () => {
    const afterSend = vi.fn();
    const sendTabMessage = vi.fn((tabId, payload, options, callback) => {
      callback("translated");
    });

    await expect(
      queryMainFrame(12, "getCurrentPageLanguageState", sendTabMessage, afterSend)
    ).resolves.toBe("translated");

    expect(buildFrameFocusBroadcastEffect({ tab: { id: 12 } })).toEqual([
      {
        type: "send-tab-message",
        tabId: 12,
        message: { action: "anotherFrameIsInFocus" },
      },
    ]);
  });

  it("combines hostname/language/mimeType queries with open-tab execution effects", async () => {
    const detectLanguage = vi.fn((tabId, callback) => {
      callback("fr");
    });
    const queryTabs = vi.fn((query, callback) => {
      callback([{ id: 9 }]);
    });
    const storageGet = vi.fn(async () => ({
      tabToMimeType: {
        9: "application/pdf",
      },
    }));

    expect(executeSenderTabHostNameQuery({ tab: { url: "https://docs.example.com/path" } })).toBe("docs.example.com");
    await expect(
      executeSenderTabLanguageQuery({
        sender: { tab: { id: 9 } },
        detectLanguage,
      })
    ).resolves.toBe("fr");
    await expect(
      executeQueriedActiveTabMimeType({
        queryTabs,
        getStorage: storageGet,
      })
    ).resolves.toBe("application/pdf");

    expect(buildOpenOptionsPageEffect("chrome-extension://id/options/options.html")).toEqual([
      {
        type: "open-tab",
        url: "chrome-extension://id/options/options.html",
      },
    ]);
    expect(buildOpenDonationPageEffect("chrome-extension://id/options/options.html#donation")).toEqual([
      {
        type: "open-tab",
        url: "chrome-extension://id/options/options.html#donation",
      },
    ]);
  });

  it("combines sender queries with the feedback open-tab effect (content script → SW → effect → tab)", () => {
    // 端到端消息流：内容脚本点击 ⚠ 的完整等价路径 ——
    // 载荷 → buildOpenFeedbackIssueEffect → open-tab 效果（交由 tab 执行器打开）
    expect(executeSenderTabHostNameQuery({ tab: { url: "https://x.com/home" } })).toBe("x.com");

    const effects = buildOpenFeedbackIssueEffect({
      serviceType: "google",
      errorText: "429 quota exceeded",
      hostname: "x.com",
      sourceLang: "en",
      targetLang: "zh-CN",
      version: "2.1.30",
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    });

    expect(effects).toHaveLength(1);
    expect(effects[0].type).toBe("open-tab");
    const params = new URL(effects[0].url).searchParams;
    expect(params.get("template")).toBe("bug_report.yml");
    expect(params.get("extension-version")).toBe("2.1.30");
    expect(params.get("service")).toBe("Google Translate");
    expect(params.get("additional")).toBe(
      "Hostname: x.com\nLanguage pair: en → zh-CN\nError: 429 quota exceeded"
    );
  });
});