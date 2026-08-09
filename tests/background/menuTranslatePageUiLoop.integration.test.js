import { describe, expect, it, vi } from "vitest";
import { resolveBasicMenuClickAction } from "../../src/background/menuClickHelpers.js";
import { buildBasicMenuEffectPlan } from "../../src/background/menuExecutionHelpers.js";
import {
  buildTranslatePageContextMenuRefreshPlan,
  executeContextMenuEffects,
} from "../../src/background/contextMenuExecutionHelpers.js";
import {
  buildIconEffectPlan,
  resolveActionIconPath,
  resolveIconUpdateFromRuntimeMessage,
  resolveSvgIconAppearance,
} from "../../src/background/iconHelpers.js";

describe("menu translate-page ui loop integration", () => {
  it("combines translate-page-google menu click with translated runtime UI updates", () => {
    const menuClickAction = resolveBasicMenuClickAction({
      menuItemId: "translate-page-google",
      tabId: 18,
    });

    expect(buildBasicMenuEffectPlan(menuClickAction)).toEqual([
      {
        type: "send-tab-message",
        tabId: 18,
        message: {
          action: "translate-page-google",
        },
      },
    ]);

    const removeContextMenu = vi.fn();
    const createContextMenu = vi.fn();
    const request = {
      action: "setPageLanguageState",
      pageLanguageState: "translated",
    };

    const contextMenuEffects = buildTranslatePageContextMenuRefreshPlan({
      isEnabled: true,
      pageLanguageState: request.pageLanguageState,
      restoreLabel: "Restore original",
      targetLanguageName: "French",
      buildTranslateForLabel: (languageName) => `Translate to ${languageName}`,
    });

    executeContextMenuEffects(contextMenuEffects, {
      removeContextMenu,
      createContextMenu,
    });

    expect(removeContextMenu).toHaveBeenCalledWith("translate-page-google", undefined);
    expect(removeContextMenu).toHaveBeenCalledWith("translate-page-ai", undefined);
    expect(removeContextMenu).toHaveBeenCalledWith("restore-original", undefined);
    expect(createContextMenu).toHaveBeenCalledWith({
      id: "restore-original",
      title: "Restore original",
      contexts: ["page", "frame"],
    }, undefined);

    const iconUpdate = resolveIconUpdateFromRuntimeMessage(request, 18);
    expect(buildIconEffectPlan({
      tabId: iconUpdate.updateTabId,
      hasPageAction: true,
      hasAction: true,
      pageActionIconPath: resolveSvgIconAppearance({
        pageLanguageState: iconUpdate.nextPageLanguageState,
        popupBlueWhenSiteIsTranslated: "yes",
        themeColorFieldText: "#222222",
        themeColorAttention: "#ff5500",
      }),
      actionIconPath: resolveActionIconPath({
        pageLanguageState: iconUpdate.nextPageLanguageState,
        popupBlueWhenSiteIsTranslated: "yes",
      }),
      showButtonInTheAddressBar: "yes",
    })).toEqual([
      {
        type: "reset-page-action",
        tabId: 18,
        forceShow: false,
      },
      {
        type: "set-page-action-icon",
        tabId: 18,
        path: {
          fillOpacity: "1.0",
          fillColor: "#ff5500",
        },
      },
      {
        type: "show-page-action",
        tabId: 18,
      },
      {
        type: "set-action-icon",
        tabId: 18,
        path: "/icons/icon-32-translated.png",
      },
    ]);
  });

  it("combines restore-original menu click with original runtime UI updates", () => {
    const menuClickAction = resolveBasicMenuClickAction({
      menuItemId: "restore-original",
      tabId: 18,
    });

    expect(buildBasicMenuEffectPlan(menuClickAction)).toEqual([
      {
        type: "send-tab-message",
        tabId: 18,
        message: {
          action: "restore-original",
        },
      },
    ]);

    const removeContextMenu = vi.fn();
    const createContextMenu = vi.fn();
    const request = {
      action: "setPageLanguageState",
      pageLanguageState: "original",
    };

    const contextMenuEffects = buildTranslatePageContextMenuRefreshPlan({
      isEnabled: true,
      pageLanguageState: request.pageLanguageState,
      restoreLabel: "Restore original",
      targetLanguageName: "French",
      buildTranslateForLabel: (languageName) => `Translate to ${languageName}`,
    });

    executeContextMenuEffects(contextMenuEffects, {
      removeContextMenu,
      createContextMenu,
    });

    expect(removeContextMenu).toHaveBeenCalledWith("restore-original", undefined);
    expect(removeContextMenu).toHaveBeenCalledWith("translate-page-google", undefined);
    expect(removeContextMenu).toHaveBeenCalledWith("translate-page-ai", undefined);
    expect(createContextMenu).toHaveBeenCalledWith({
      id: "translate-page-google",
      title: "Translate to French",
      contexts: ["page", "frame"],
    }, undefined);
    expect(createContextMenu).toHaveBeenCalledWith({
      id: "translate-page-ai",
      title: "🤖 Translate to French",
      contexts: ["page", "frame"],
    }, undefined);

    const iconUpdate = resolveIconUpdateFromRuntimeMessage(request, 18);
    expect(buildIconEffectPlan({
      tabId: iconUpdate.updateTabId,
      hasPageAction: true,
      hasAction: true,
      pageActionIconPath: resolveSvgIconAppearance({
        pageLanguageState: iconUpdate.nextPageLanguageState,
        popupBlueWhenSiteIsTranslated: "yes",
        themeColorFieldText: "#222222",
        themeColorAttention: "#ff5500",
      }),
      actionIconPath: resolveActionIconPath({
        pageLanguageState: iconUpdate.nextPageLanguageState,
        popupBlueWhenSiteIsTranslated: "yes",
      }),
      showButtonInTheAddressBar: "no",
    })).toEqual([
      {
        type: "reset-page-action",
        tabId: 18,
        forceShow: false,
      },
      {
        type: "set-page-action-icon",
        tabId: 18,
        path: {
          fillOpacity: "0.5",
          fillColor: "#222222",
        },
      },
      {
        type: "hide-page-action",
        tabId: 18,
      },
      {
        type: "set-action-icon",
        tabId: 18,
        path: "/icons/icon-32.png",
      },
    ]);
  });
});