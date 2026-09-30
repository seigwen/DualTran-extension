import { describe, expect, it } from "vitest";
import {
  buildFrameFocusBroadcastEffect,
  buildOpenDonationPageEffect,
  buildOpenFeedbackIssueEffect,
  buildOpenOptionsPageEffect,
  createRuntimeMessageEffectExecutor,
  executeMainFrameRuntimeQuery,
  executeSenderTabHostNameQuery,
  executeSenderTabLanguageQuery,
  executeQueriedActiveTabMimeType,
} from "../../src/background/runtimeMessageExecutionHelpers.js";

describe("runtimeMessageExecutionHelpers", () => {
  it("builds an open-tab effect for the options page", () => {
    expect(buildOpenOptionsPageEffect("chrome-extension://id/options/options.html")).toEqual([
      {
        type: "open-tab",
        url: "chrome-extension://id/options/options.html",
      },
    ]);

    expect(buildOpenOptionsPageEffect("")).toEqual([]);
  });

  it("builds an open-tab effect for the donation page", () => {
    expect(buildOpenDonationPageEffect("chrome-extension://id/options/options.html#donation")).toEqual([
      {
        type: "open-tab",
        url: "chrome-extension://id/options/options.html#donation",
      },
    ]);

    expect(buildOpenDonationPageEffect(null)).toEqual([]);
  });

  it("broadcasts focus to sibling frames only when a sender tab exists", () => {
    expect(buildFrameFocusBroadcastEffect({ tab: { id: 12 } })).toEqual([
      {
        type: "send-tab-message",
        tabId: 12,
        message: { action: "anotherFrameIsInFocus" },
      },
    ]);

    expect(buildFrameFocusBroadcastEffect({})).toEqual([]);
  });

  it("queries the active tab mimeType through the shared runtime execution bridge", async () => {
    const queryTabs = (queryInfo, callback) => {
      expect(queryInfo).toEqual({
        active: true,
        currentWindow: true,
      });
      callback([{ id: 9 }]);
    };
    const getStorage = async (keys) => {
      expect(keys).toEqual(["tabToMimeType"]);
      return {
        tabToMimeType: {
          9: "application/pdf",
        },
      };
    };

    await expect(
      executeQueriedActiveTabMimeType({
        queryTabs,
        getStorage,
      })
    ).resolves.toBe("application/pdf");

    await expect(executeQueriedActiveTabMimeType()).resolves.toBeUndefined();
  });

  it("queries the sender tab main frame through the shared runtime execution bridge", async () => {
    const afterSend = () => undefined;
    const sendTabMessage = (tabId, payload, options, callback) => {
      expect(tabId).toBe(12);
      expect(payload).toEqual({ action: "getCurrentPageLanguageState" });
      expect(options).toEqual({ frameId: 0 });
      callback("translated");
    };

    await expect(
      executeMainFrameRuntimeQuery({
        sender: { tab: { id: 12 } },
        action: "getCurrentPageLanguageState",
        sendTabMessage,
        afterSend,
      })
    ).resolves.toBe("translated");

    await expect(executeMainFrameRuntimeQuery()).resolves.toBeUndefined();
  });

  it("queries the sender tab language through the shared runtime execution bridge", async () => {
    const detectLanguage = (tabId, callback) => {
      expect(tabId).toBe(9);
      callback("fr");
    };

    await expect(
      executeSenderTabLanguageQuery({
        sender: { tab: { id: 9 } },
        detectLanguage,
      })
    ).resolves.toBe("fr");

    await expect(executeSenderTabLanguageQuery()).resolves.toBe("und");
  });

  it("reads the sender tab hostname through the shared runtime execution bridge", () => {
    expect(
      executeSenderTabHostNameQuery({
        tab: {
          url: "https://docs.example.com/path",
        },
      })
    ).toBe("docs.example.com");

    expect(executeSenderTabHostNameQuery()).toBeUndefined();
  });

  it("creates a runtime message effect executor that forwards effect lists to the shared tab executor", () => {
    const applyTabEffects = vi.fn();
    const executeEffects = createRuntimeMessageEffectExecutor({ applyTabEffects });
    const effects = [
      {
        type: "open-tab",
        url: "chrome-extension://id/options/options.html",
      },
    ];

    executeEffects(effects);

    expect(applyTabEffects).toHaveBeenCalledWith(effects);
  });

  // ── Feedback issue effect (plan 35 — user feedback channel) ──

  it("builds an open-tab effect pointing at the prefilled GitHub issue form", () => {
    const effects = buildOpenFeedbackIssueEffect({
      serviceType: "google",
      errorText: "429 quota",
      hostname: "x.com",
      sourceLang: "en",
      targetLang: "zh-CN",
      version: "2.1.30",
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      providerId: "",
    });

    expect(effects).toHaveLength(1);
    expect(effects[0].type).toBe("open-tab");
    expect(effects[0].url).toBe(
      "https://github.com/seigwen/DualTran-extension/issues/new?template=bug_report.yml&extension-version=2.1.30&browser=Chrome&os=Linux&service=Google+Translate&additional=Hostname%3A+x.com%0ALanguage+pair%3A+en+%E2%86%92+zh-CN%0AError%3A+429+quota"
    );
  });

  it("no-ops (empty effect list) when serviceType is invalid — never opens a tab", () => {
    expect(buildOpenFeedbackIssueEffect({ serviceType: "bogus", version: "2.1.30" })).toEqual([]);
    expect(buildOpenFeedbackIssueEffect({ version: "2.1.30" })).toEqual([]);
    expect(buildOpenFeedbackIssueEffect({ serviceType: 42, version: "2.1.30" })).toEqual([]);
  });

  it("no-ops when the version is missing (the SW cannot build a meaningful report)", () => {
    expect(
      buildOpenFeedbackIssueEffect({ serviceType: "google", version: "" })
    ).toEqual([]);
    expect(buildOpenFeedbackIssueEffect({ serviceType: "google" })).toEqual([]);
  });

  it("clamps oversized error text and keeps the URL github.com-rooted (injection guard)", () => {
    const effects = buildOpenFeedbackIssueEffect({
      serviceType: "ai",
      providerId: "openrouter",
      errorText: "e".repeat(1200),
      hostname: "x.com",
      sourceLang: "en",
      targetLang: "zh-CN",
      version: "2.1.30",
      userAgent: "Chrome/123.0.0.0",
    });

    const url = effects[0].url;
    expect(url.startsWith("https://github.com/seigwen/DualTran-extension/issues/new?")).toBe(true);
    const errLine = new URL(url)
      .searchParams.get("additional")
      .split("\n")
      .find((l) => l.startsWith("Error: "));
    expect(errLine.length).toBeLessThanOrEqual("Error: ".length + 500);
  });
});