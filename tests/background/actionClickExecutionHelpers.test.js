import { describe, expect, it, vi } from "vitest";
import {
  buildDesktopActionClickEffects,
  buildMobileActionClickEffects,
  buildPageActionHideEffects,
  createActionClickEffectExecutor,
  executeInitialPageActionHide,
  executeActionClickEffects,
} from "../../src/background/actionClickExecutionHelpers.js";

describe("actionClickExecutionHelpers", () => {
  it("builds hide effects for each pageAction tab id", () => {
    expect(buildPageActionHideEffects([3, 18])).toEqual([
      { type: "hide-page-action", tabId: 3 },
      { type: "hide-page-action", tabId: 18 },
    ]);

    expect(buildPageActionHideEffects([])).toEqual([]);
  });

  it("queries all tabs before dispatching initial pageAction hide effects", () => {
    const queryTabs = vi.fn((queryInfo, callback) => {
      callback([{ id: 3 }, { id: 18 }, { url: "https://example.com/no-id" }]);
    });
    const applyEffects = vi.fn();

    executeInitialPageActionHide({
      queryTabs,
      applyEffects,
    });

    expect(queryTabs).toHaveBeenCalledWith({}, expect.any(Function));
    expect(applyEffects).toHaveBeenCalledWith([
      { type: "hide-page-action", tabId: 3 },
      { type: "hide-page-action", tabId: 18 },
    ]);
  });

  it("builds the mobile action click send-message effect with frameId 0", () => {
    expect(buildMobileActionClickEffects(18, { action: "showPopupMobile" })).toEqual([
      {
        type: "send-tab-message",
        tabId: 18,
        message: { action: "showPopupMobile" },
        options: { frameId: 0 },
      },
    ]);

    expect(buildMobileActionClickEffects(undefined, { action: "showPopupMobile" })).toEqual([]);
  });

  it("builds the desktop action click send-message effect only when a message exists", () => {
    expect(buildDesktopActionClickEffects(7, { action: "toggle-translation" })).toEqual([
      {
        type: "send-tab-message",
        tabId: 7,
        message: { action: "toggle-translation" },
      },
    ]);

    expect(buildDesktopActionClickEffects(7, null)).toEqual([]);
  });

  it("executes hide and send-message action click effects", () => {
    const hidePageAction = vi.fn();
    const sendTabMessage = vi.fn();
    const sendMessageCallback = vi.fn();

    executeActionClickEffects([
      { type: "hide-page-action", tabId: 3 },
      {
        type: "send-tab-message",
        tabId: 18,
        message: { action: "showPopupMobile" },
        options: { frameId: 0 },
      },
    ], {
      hidePageAction,
      sendTabMessage,
      sendMessageCallback,
    });

    expect(hidePageAction).toHaveBeenCalledWith(3);
    expect(sendTabMessage).toHaveBeenCalledWith(
      18,
      { action: "showPopupMobile" },
      { frameId: 0 },
      sendMessageCallback
    );
  });

  it("ignores unsupported effects and missing handlers", () => {
    expect(() => {
      executeActionClickEffects([
        { type: "noop" },
        { type: "hide-page-action", tabId: 1 },
      ]);
    }).not.toThrow();

    expect(() => {
      executeInitialPageActionHide();
    }).not.toThrow();
  });

  it("creates an action click effect executor that routes hide and send-message effects", () => {
    const hidePageAction = vi.fn();
    const sendTabMessage = vi.fn();
    const sendMessageCallback = vi.fn();

    const executeEffects = createActionClickEffectExecutor({
      hidePageAction,
      sendTabMessage,
      sendMessageCallback,
    });

    executeEffects([
      { type: "hide-page-action", tabId: 3 },
      {
        type: "send-tab-message",
        tabId: 18,
        message: { action: "showPopupMobile" },
        options: { frameId: 0 },
      },
    ]);

    expect(hidePageAction).toHaveBeenCalledWith(3);
    expect(sendTabMessage).toHaveBeenCalledWith(
      18,
      { action: "showPopupMobile" },
      { frameId: 0 },
      sendMessageCallback
    );
  });
});