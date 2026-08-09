import { describe, expect, it, vi } from "vitest";
import {
  buildContextMenuRefreshEffects,
  buildTranslatePageContextMenuEffects,
  buildTranslatePageContextMenuRefreshPlan,
  buildTranslateSelectedContextMenuEffects,
  buildTranslateSelectedContextMenuRefreshPlan,
  executeActivatedContextMenuRefresh,
  executeContextMenuEffects,
  executeStaticContextMenuRegistration,
} from "../../src/background/contextMenuExecutionHelpers.js";

describe("contextMenuExecutionHelpers", () => {
  it("always removes the existing menu before optionally recreating it", () => {
    expect(buildContextMenuRefreshEffects("menu-id", {
      id: "menu-id",
      title: "Translate",
    })).toEqual([
      { type: "remove-context-menu", menuId: "menu-id" },
      { type: "create-context-menu", config: { id: "menu-id", title: "Translate" } },
    ]);

    expect(buildContextMenuRefreshEffects("menu-id", null)).toEqual([
      { type: "remove-context-menu", menuId: "menu-id" },
    ]);
  });

  it("builds selected-text context menu refresh effects", () => {
    expect(buildTranslateSelectedContextMenuEffects({
      id: "translate-selected-text",
      title: "Translate selected text",
      contexts: ["selection"],
    })).toEqual([
      { type: "remove-context-menu", menuId: "translate-selected-text" },
      {
        type: "create-context-menu",
        config: {
          id: "translate-selected-text",
          title: "Translate selected text",
          contexts: ["selection"],
        },
      },
    ]);
  });

  it("builds page context menu refresh effects", () => {
    expect(buildTranslatePageContextMenuEffects({
      id: "translate-web-page",
      title: "Translate to French",
      contexts: ["page", "frame"],
    })).toEqual([
      { type: "remove-context-menu", menuId: "translate-web-page" },
      {
        type: "create-context-menu",
        config: {
          id: "translate-web-page",
          title: "Translate to French",
          contexts: ["page", "frame"],
        },
      },
    ]);
  });

  it("builds selected-text refresh plans from enablement and title", () => {
    expect(buildTranslateSelectedContextMenuRefreshPlan({
      isEnabled: true,
      title: "Translate selected text",
    })).toEqual([
      { type: "remove-context-menu", menuId: "translate-selected-text" },
      {
        type: "create-context-menu",
        config: {
          id: "translate-selected-text",
          title: "Translate selected text",
          contexts: ["selection"],
        },
      },
    ]);

    expect(buildTranslateSelectedContextMenuRefreshPlan({
      isEnabled: false,
      title: "Translate selected text",
    })).toEqual([
      { type: "remove-context-menu", menuId: "translate-selected-text" },
    ]);
  });

  it("builds page refresh plans from language state and labels", () => {
    expect(buildTranslatePageContextMenuRefreshPlan({
      isEnabled: true,
      pageLanguageState: "original",
      restoreLabel: "Restore",
      targetLanguageName: "French",
      buildTranslateForLabel: (languageName) => `Translate to ${languageName}`,
    })).toEqual([
      { type: "remove-context-menu", menuId: "restore-original" },
      { type: "remove-context-menu", menuId: "translate-page-google" },
      {
        type: "create-context-menu",
        config: {
          id: "translate-page-google",
          title: "Translate to French",
          contexts: ["page", "frame"],
        },
      },
      { type: "remove-context-menu", menuId: "translate-page-ai" },
      {
        type: "create-context-menu",
        config: {
          id: "translate-page-ai",
          title: "🤖 Translate to French",
          contexts: ["page", "frame"],
        },
      },
    ]);

    expect(buildTranslatePageContextMenuRefreshPlan({
      isEnabled: true,
      pageLanguageState: "translated",
      restoreLabel: "Restore",
      targetLanguageName: "French",
      buildTranslateForLabel: (languageName) => `Translate to ${languageName}`,
    })).toEqual([
      { type: "remove-context-menu", menuId: "translate-page-google" },
      { type: "remove-context-menu", menuId: "translate-page-ai" },
      { type: "remove-context-menu", menuId: "restore-original" },
      {
        type: "create-context-menu",
        config: {
          id: "restore-original",
          title: "Restore",
          contexts: ["page", "frame"],
        },
      },
    ]);
  });

  it("executes remove/create context menu effects in order", () => {
    const removeContextMenu = vi.fn();
    const createContextMenu = vi.fn();
    const removeCallback = vi.fn();
    const createCallback = vi.fn();

    executeContextMenuEffects([
      { type: "remove-context-menu", menuId: "translate-web-page" },
      {
        type: "create-context-menu",
        config: { id: "translate-web-page", title: "Translate" },
      },
    ], {
      removeContextMenu,
      createContextMenu,
      removeCallback,
      createCallback,
    });

    expect(removeContextMenu).toHaveBeenCalledWith("translate-web-page", removeCallback);
    expect(createContextMenu).toHaveBeenCalledWith(
      { id: "translate-web-page", title: "Translate" },
      createCallback
    );
  });

  it("registers static context menus through the shared execution helper", () => {
    const createContextMenu = vi.fn();
    const createCallback = vi.fn();

    executeStaticContextMenuRegistration([
      { id: "browserAction-showPopup", title: "Show popup" },
      { id: "pageAction-showPopup", title: "Show popup" },
    ], {
      createContextMenu,
      createCallback,
    });

    expect(createContextMenu.mock.calls).toEqual([
      [{ id: "browserAction-showPopup", title: "Show popup" }, createCallback],
      [{ id: "pageAction-showPopup", title: "Show popup" }, createCallback],
    ]);

    expect(() => executeStaticContextMenuRegistration()).not.toThrow();
  });

  it("ignores unsupported effects and missing handlers", () => {
    expect(() => {
      executeContextMenuEffects([
        { type: "noop" },
        { type: "create-context-menu", config: { id: "menu" } },
      ]);
    }).not.toThrow();
  });

  it("refreshes activated-tab context menu before and after the main-frame query", async () => {
    const applyContextMenuRefresh = vi.fn();
    const sendTabMessage = vi.fn((tabId, payload, options, callback) => {
      callback("translated");
    });
    const afterSend = vi.fn();

    await expect(
      executeActivatedContextMenuRefresh(18, {
        applyContextMenuRefresh,
        sendTabMessage,
        afterSend,
      })
    ).resolves.toEqual({
      pageLanguageState: "translated",
    });

    expect(applyContextMenuRefresh.mock.calls).toEqual([
      ["original"],
      ["translated"],
    ]);
    expect(sendTabMessage).toHaveBeenCalledWith(
      18,
      { action: "getCurrentPageLanguageState" },
      { frameId: 0 },
      expect.any(Function)
    );
    expect(afterSend).toHaveBeenCalledTimes(1);
  });

  it("skips activated-tab context menu refresh when tabId or send handler is missing", async () => {
    const applyContextMenuRefresh = vi.fn();

    await expect(
      executeActivatedContextMenuRefresh(undefined, {
        applyContextMenuRefresh,
      })
    ).resolves.toBeNull();

    await expect(
      executeActivatedContextMenuRefresh(18, {
        applyContextMenuRefresh,
      })
    ).resolves.toBeNull();

    expect(applyContextMenuRefresh).not.toHaveBeenCalled();
  });
});