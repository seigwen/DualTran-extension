import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("detect-pdf", () => {
  let testUrl;
  let testMimeType;

  async function loadModule() {
    await import("../../src/popup/detect-pdf.js");
  }

  beforeEach(() => {
    vi.resetModules();
    testUrl = "https://example.com/page.html";
    testMimeType = undefined;

    vi.stubGlobal("window", { location: "popup.html" });
    globalThis.chrome = {
      tabs: {
        query: vi.fn((_opts, callback) => callback(testUrl ? [{ url: testUrl }] : [])),
      },
      runtime: {
        sendMessage: vi.fn((_message, callback) => callback(testMimeType)),
      },
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete globalThis.chrome;
  });

  it("redirects when the active tab URL ends with .pdf", async () => {
    testUrl = "https://example.com/file.pdf";

    await loadModule();

    expect(window.location).toBe("popup-translate-document.html");
  });

  it("redirects when the active tab URL ends with .PDF", async () => {
    testUrl = "https://example.com/file.PDF";

    await loadModule();

    expect(window.location).toBe("popup-translate-document.html");
  });

  it("does not redirect when the active tab URL is not a PDF", async () => {
    testUrl = "https://example.com/file.doc";

    await loadModule();

    expect(window.location).toBe("popup.html");
  });

  it("does not redirect when there is no active tab URL", async () => {
    testUrl = null;

    await loadModule();

    expect(window.location).toBe("popup.html");
  });

  it("redirects when the active tab MIME type is application/pdf", async () => {
    testMimeType = "application/pdf";

    await loadModule();

    expect(window.location).toBe("popup-translate-document.html");
  });

  it("does not redirect when the MIME type is not a PDF", async () => {
    testMimeType = "text/html";

    await loadModule();

    expect(window.location).toBe("popup.html");
  });

  it("does not redirect when the MIME type is null or undefined", async () => {
    testMimeType = null;
    await loadModule();
    expect(window.location).toBe("popup.html");

    vi.resetModules();
    window.location = "popup.html";
    testMimeType = undefined;
    await loadModule();

    expect(window.location).toBe("popup.html");
  });

  it("queries the active tab and requests the tab MIME type", async () => {
    await loadModule();

    expect(chrome.tabs.query).toHaveBeenCalledWith(
      { active: true, currentWindow: true },
      expect.any(Function)
    );
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: "getTabMimeType" },
      expect.any(Function)
    );
  });
});
