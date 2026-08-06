import { beforeEach, describe, expect, it, vi } from "vitest";

describe("checkScriptIsInjected", () => {
  let messageListeners;

  beforeEach(() => {
    vi.resetModules();
    messageListeners = [];
    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn((cb) => messageListeners.push(cb)),
        },
      },
    };
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  async function loadModule() {
    await import("../../src/contentScript/checkScriptIsInjected.js");
  }

  it("registers a message listener on load", async () => {
    await loadModule();
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledOnce();
    expect(messageListeners).toHaveLength(1);
  });

  it("responds true when action is 'contentScriptIsInjected'", async () => {
    await loadModule();
    const sendResponse = vi.fn();
    messageListeners[0](
      { action: "contentScriptIsInjected" },
      {},
      sendResponse
    );
    expect(sendResponse).toHaveBeenCalledWith(true);
  });

  it("does not respond to unrelated actions", async () => {
    await loadModule();
    const sendResponse = vi.fn();
    messageListeners[0]({ action: "somethingElse" }, {}, sendResponse);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("does not respond when request has no action", async () => {
    await loadModule();
    const sendResponse = vi.fn();
    messageListeners[0]({}, {}, sendResponse);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
