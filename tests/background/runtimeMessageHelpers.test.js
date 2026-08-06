import { describe, expect, it, vi } from "vitest";
import {
  detectTabLanguageForSender,
  getActiveTabMimeType,
  getTabHostNameFromSender,
  queryMainFrame,
} from "../../src/background/runtimeMessageHelpers.js";

describe("runtimeMessageHelpers", () => {
  it("extracts the hostname from the sender tab url", () => {
    expect(
      getTabHostNameFromSender({
        tab: { url: "https://sub.example.com/path?q=1" },
      })
    ).toBe("sub.example.com");
  });

  it("queries the main frame with frameId 0 and runs afterSend before resolving", async () => {
    const afterSend = vi.fn();
    const sendTabMessage = vi.fn((tabId, payload, options, callback) => {
      callback("translated");
    });

    await expect(
      queryMainFrame(12, "getCurrentPageLanguageState", sendTabMessage, afterSend)
    ).resolves.toBe("translated");

    expect(sendTabMessage).toHaveBeenCalledWith(
      12,
      { action: "getCurrentPageLanguageState" },
      { frameId: 0 },
      expect.any(Function)
    );
    expect(afterSend).toHaveBeenCalledOnce();
  });

  it("returns detected language for a sender tab", async () => {
    const detectLanguage = vi.fn((tabId, callback) => {
      callback("fr");
    });

    await expect(
      detectTabLanguageForSender({ tab: { id: 42 } }, detectLanguage)
    ).resolves.toBe("fr");
    expect(detectLanguage).toHaveBeenCalledWith(42, expect.any(Function));
  });

  it("falls back to und when the sender has no tab or detectLanguage throws", async () => {
    await expect(detectTabLanguageForSender({}, vi.fn())).resolves.toBe("und");

    const detectLanguage = vi.fn(() => {
      throw new Error("tabs API unavailable");
    });

    await expect(
      detectTabLanguageForSender({ tab: { id: 7 } }, detectLanguage)
    ).resolves.toBe("und");
  });

  it("returns the active tab mimeType from storage", async () => {
    const queryTabs = vi.fn((query, callback) => {
      callback([{ id: 9 }]);
    });
    const storageGet = vi.fn(async () => ({
      tabToMimeType: {
        9: "application/pdf",
      },
    }));

    await expect(getActiveTabMimeType(queryTabs, storageGet)).resolves.toBe("application/pdf");
    expect(queryTabs).toHaveBeenCalledWith(
      { active: true, currentWindow: true },
      expect.any(Function)
    );
    expect(storageGet).toHaveBeenCalledWith(["tabToMimeType"]);
  });

  it("returns undefined when the active tab or stored mimeType is missing", async () => {
    const queryTabs = vi.fn((query, callback) => {
      callback([]);
    });
    const storageGet = vi.fn(async () => ({ tabToMimeType: {} }));

    await expect(getActiveTabMimeType(queryTabs, storageGet)).resolves.toBeUndefined();
  });
});