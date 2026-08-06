import { describe, expect, it, vi } from "vitest";
import {
  createTabEffectExecutor,
  executeTabEffects,
} from "../../src/background/tabExecutionHelpers.js";

describe("tabExecutionHelpers", () => {
  it("dispatches open-tab, reload-tab, and send-tab-message effects", () => {
    const createTab = vi.fn();
    const reloadTab = vi.fn();
    const sendTabMessage = vi.fn();
    const sendMessageCallback = vi.fn();

    executeTabEffects([
      {
        type: "open-tab",
        url: "https://example.com/docs",
      },
      {
        type: "reload-tab",
        tabId: 4,
      },
      {
        type: "send-tab-message",
        tabId: 8,
        message: { action: "toggle-translation" },
      },
    ], {
      createTab,
      reloadTab,
      sendTabMessage,
      sendMessageCallback,
    });

    expect(createTab).toHaveBeenCalledWith({
      url: "https://example.com/docs",
    });
    expect(reloadTab).toHaveBeenCalledWith(4);
    expect(sendTabMessage).toHaveBeenCalledWith(
      8,
      { action: "toggle-translation" },
      sendMessageCallback
    );
  });

  it("preserves options when sending tab messages", () => {
    const sendTabMessage = vi.fn();

    executeTabEffects([
      {
        type: "send-tab-message",
        tabId: 11,
        message: { action: "showPopupMobile" },
        options: { frameId: 0 },
      },
    ], {
      sendTabMessage,
    });

    expect(sendTabMessage).toHaveBeenCalledWith(
      11,
      { action: "showPopupMobile" },
      { frameId: 0 }
    );
  });

  it("ignores unsupported effects and missing handlers", () => {
    expect(() => {
      executeTabEffects([
        { type: "noop" },
        { type: "open-tab", url: "https://example.com" },
      ]);
    }).not.toThrow();
  });

  it("creates a tab effect executor that binds open, reload, and send handlers", () => {
    const createTab = vi.fn();
    const reloadTab = vi.fn();
    const sendTabMessage = vi.fn();
    const executeEffects = createTabEffectExecutor({
      createTab,
      reloadTab,
      sendTabMessage,
    });

    executeEffects([
      { type: "open-tab", url: "https://example.com/help" },
      { type: "reload-tab", tabId: 7 },
      { type: "send-tab-message", tabId: 9, message: { action: "ping" } },
    ]);

    expect(createTab).toHaveBeenCalledWith({ url: "https://example.com/help" });
    expect(reloadTab).toHaveBeenCalledWith(7);
    expect(sendTabMessage).toHaveBeenCalledWith(9, { action: "ping" });
  });
});