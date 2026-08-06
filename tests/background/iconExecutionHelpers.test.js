import { describe, expect, it, vi } from "vitest";
import {
  createIconEffectExecutor,
  executeAllTabIconRefresh,
  executeActivatedTabIconRefresh,
  executeIconEffects,
  executeQueriedTabIconRefresh,
} from "../../src/background/iconExecutionHelpers.js";

describe("iconExecutionHelpers", () => {
  it("queries all tabs before refreshing a single tab icon", () => {
    const queryTabs = vi.fn((queryInfo, callback) => {
      callback([
        { id: 3, incognito: false },
        { id: 18, incognito: true },
      ]);
    });
    const applyIconUpdate = vi.fn();

    executeQueriedTabIconRefresh(18, {
      queryTabs,
      applyIconUpdate,
    });

    expect(queryTabs).toHaveBeenCalledWith({}, expect.any(Function));
    expect(applyIconUpdate).toHaveBeenCalledWith(18, true);
  });

  it("queries all tabs once before refreshing every tab icon", () => {
    const queryTabs = vi.fn((queryInfo, callback) => {
      callback([
        { id: 3, incognito: false },
        { id: 18, incognito: true },
        { url: "https://example.com" },
      ]);
    });
    const applyIconUpdate = vi.fn();

    executeAllTabIconRefresh({
      queryTabs,
      applyIconUpdate,
    });

    expect(queryTabs).toHaveBeenCalledWith({}, expect.any(Function));
    expect(applyIconUpdate.mock.calls).toEqual([
      [3, false],
      [18, true],
    ]);
  });

  it("skips queried icon refresh bridges when required handlers are missing", () => {
    const applyIconUpdate = vi.fn();

    expect(() => {
      executeQueriedTabIconRefresh(undefined, { applyIconUpdate });
      executeQueriedTabIconRefresh(18, { applyIconUpdate });
      executeAllTabIconRefresh({ applyIconUpdate });
    }).not.toThrow();

    expect(applyIconUpdate).not.toHaveBeenCalled();
  });

  it("refreshes icon state on tab activation before and after the main-frame query", async () => {
    const setPageLanguageState = vi.fn();
    const applyIconUpdate = vi.fn();
    const sendTabMessage = vi.fn((tabId, payload, options, callback) => {
      callback("translated");
    });
    const afterSend = vi.fn();

    await expect(
      executeActivatedTabIconRefresh(18, {
        setPageLanguageState,
        applyIconUpdate,
        sendTabMessage,
        afterSend,
      })
    ).resolves.toEqual({
      nextPageLanguageState: "translated",
      updateTabId: 18,
    });

    expect(setPageLanguageState.mock.calls).toEqual([
      ["original"],
      ["translated"],
    ]);
    expect(applyIconUpdate.mock.calls).toEqual([
      [18],
      [18],
    ]);
    expect(sendTabMessage).toHaveBeenCalledWith(
      18,
      { action: "getCurrentPageLanguageState" },
      { frameId: 0 },
      expect.any(Function)
    );
    expect(afterSend).toHaveBeenCalledTimes(1);
  });

  it("skips activated-tab icon refresh when tabId or send handler is missing", async () => {
    const setPageLanguageState = vi.fn();
    const applyIconUpdate = vi.fn();

    await expect(
      executeActivatedTabIconRefresh(undefined, {
        setPageLanguageState,
        applyIconUpdate,
      })
    ).resolves.toBeNull();

    await expect(
      executeActivatedTabIconRefresh(18, {
        setPageLanguageState,
        applyIconUpdate,
      })
    ).resolves.toBeNull();

    expect(setPageLanguageState).not.toHaveBeenCalled();
    expect(applyIconUpdate).not.toHaveBeenCalled();
  });

  it("dispatches page action and action icon effects in order", () => {
    const resetPageAction = vi.fn();
    const setPageActionIcon = vi.fn();
    const hidePageAction = vi.fn();
    const showPageAction = vi.fn();
    const setActionIcon = vi.fn();

    executeIconEffects([
      { type: "reset-page-action", tabId: 18, forceShow: false },
      { type: "set-page-action-icon", tabId: 18, path: "page-icon" },
      { type: "hide-page-action", tabId: 18 },
      { type: "show-page-action", tabId: 18 },
      { type: "set-action-icon", tabId: 18, path: "action-icon" },
    ], {
      resetPageAction,
      setPageActionIcon,
      hidePageAction,
      showPageAction,
      setActionIcon,
    });

    expect(resetPageAction).toHaveBeenCalledWith(18, false);
    expect(setPageActionIcon).toHaveBeenCalledWith({
      tabId: 18,
      path: "page-icon",
    });
    expect(hidePageAction).toHaveBeenCalledWith(18);
    expect(showPageAction).toHaveBeenCalledWith(18);
    expect(setActionIcon).toHaveBeenCalledWith({
      tabId: 18,
      path: "action-icon",
    });
  });

  it("ignores unsupported effects and missing handlers", () => {
    expect(() => {
      executeIconEffects([
        { type: "noop" },
        { type: "set-action-icon", tabId: 1, path: "icon" },
      ]);
    }).not.toThrow();
  });

  it("creates an icon effect executor that routes pageAction and action icon effects", () => {
    const resetPageAction = vi.fn();
    const setPageActionIcon = vi.fn();
    const hidePageAction = vi.fn();
    const showPageAction = vi.fn();
    const setActionIcon = vi.fn();

    const executeEffects = createIconEffectExecutor({
      resetPageAction,
      setPageActionIcon,
      hidePageAction,
      showPageAction,
      setActionIcon,
    });

    executeEffects([
      { type: "reset-page-action", tabId: 18, forceShow: false },
      { type: "set-page-action-icon", tabId: 18, path: "page-icon" },
      { type: "hide-page-action", tabId: 18 },
      { type: "show-page-action", tabId: 18 },
      { type: "set-action-icon", tabId: 18, path: "action-icon" },
    ]);

    expect(resetPageAction).toHaveBeenCalledWith(18, false);
    expect(setPageActionIcon).toHaveBeenCalledWith({ tabId: 18, path: "page-icon" });
    expect(hidePageAction).toHaveBeenCalledWith(18);
    expect(showPageAction).toHaveBeenCalledWith(18);
    expect(setActionIcon).toHaveBeenCalledWith({ tabId: 18, path: "action-icon" });
  });
});