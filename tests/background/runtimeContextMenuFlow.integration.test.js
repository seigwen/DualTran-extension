import { describe, expect, it, vi } from "vitest";
import {
  buildTranslatePageContextMenuRefreshPlan,
  executeContextMenuEffects,
} from "../../src/background/contextMenuExecutionHelpers.js";

describe("runtime context menu flow integration", () => {
  it("combines translated page-language messages with restore-title menu refresh", () => {
    const removeContextMenu = vi.fn();
    const createContextMenu = vi.fn();
    const removeCallback = vi.fn();
    const createCallback = vi.fn();
    const request = {
      action: "setPageLanguageState",
      pageLanguageState: "translated",
    };

    const effects = buildTranslatePageContextMenuRefreshPlan({
      isEnabled: true,
      pageLanguageState: request.pageLanguageState,
      restoreLabel: "Restore original",
      targetLanguageName: "French",
      buildTranslateForLabel: (languageName) => `Translate to ${languageName}`,
    });

    expect(effects).toEqual([
      { type: "remove-context-menu", menuId: "translate-page-google" },
      { type: "remove-context-menu", menuId: "translate-page-ai" },
      { type: "remove-context-menu", menuId: "restore-original" },
      {
        type: "create-context-menu",
        config: {
          id: "restore-original",
          title: "Restore original",
          contexts: ["page", "frame"],
        },
      },
    ]);

    executeContextMenuEffects(effects, {
      removeContextMenu,
      createContextMenu,
      removeCallback,
      createCallback,
    });

    expect(removeContextMenu).toHaveBeenCalledWith("translate-page-google", removeCallback);
    expect(removeContextMenu).toHaveBeenCalledWith("translate-page-ai", removeCallback);
    expect(removeContextMenu).toHaveBeenCalledWith("restore-original", removeCallback);
    expect(createContextMenu).toHaveBeenCalledWith({
      id: "restore-original",
      title: "Restore original",
      contexts: ["page", "frame"],
    }, createCallback);
  });

  it("combines original page-language messages with translate-title menu refresh", () => {
    const removeContextMenu = vi.fn();
    const createContextMenu = vi.fn();
    const removeCallback = vi.fn();
    const createCallback = vi.fn();
    const request = {
      action: "setPageLanguageState",
      pageLanguageState: "original",
    };

    const effects = buildTranslatePageContextMenuRefreshPlan({
      isEnabled: true,
      pageLanguageState: request.pageLanguageState,
      restoreLabel: "Restore original",
      targetLanguageName: "French",
      buildTranslateForLabel: (languageName) => `Translate to ${languageName}`,
    });

    expect(effects).toEqual([
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

    executeContextMenuEffects(effects, {
      removeContextMenu,
      createContextMenu,
      removeCallback,
      createCallback,
    });

    expect(removeContextMenu).toHaveBeenCalledWith("restore-original", removeCallback);
    expect(removeContextMenu).toHaveBeenCalledWith("translate-page-google", removeCallback);
    expect(removeContextMenu).toHaveBeenCalledWith("translate-page-ai", removeCallback);
    expect(createContextMenu).toHaveBeenCalledWith({
      id: "translate-page-google",
      title: "Translate to French",
      contexts: ["page", "frame"],
    }, createCallback);
    expect(createContextMenu).toHaveBeenCalledWith({
      id: "translate-page-ai",
      title: "🤖 Translate to French",
      contexts: ["page", "frame"],
    }, createCallback);
  });
});