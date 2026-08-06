import { describe, expect, it, vi } from "vitest";
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
import { resolveActiveTabTranslationInfoMessageUpdate } from "../../src/background/autoTranslateLinkHelpers.js";

describe("runtime page-language ui flow integration", () => {
  it("updates active-tab state, page menu, and icon plan for active translated messages", () => {
    const removeContextMenu = vi.fn();
    const createContextMenu = vi.fn();
    const request = {
      action: "setPageLanguageState",
      pageLanguageState: "translated",
    };
    const sender = {
      tab: {
        id: 18,
        url: "https://example.com/docs",
        active: true,
      },
    };

    expect(resolveActiveTabTranslationInfoMessageUpdate(request, sender)).toEqual({
      tabId: 18,
      pageLanguageState: "translated",
      url: "https://example.com/docs",
    });

    const contextMenuEffects = buildTranslatePageContextMenuRefreshPlan({
      isEnabled: true,
      pageLanguageState: request.pageLanguageState,
      restoreLabel: "Restore original",
      targetLanguageName: "French",
      buildTranslateForLabel: (languageName) => `Translate to ${languageName}`,
    });

    expect(contextMenuEffects).toEqual([
      { type: "remove-context-menu", menuId: "translate-web-page" },
      {
        type: "create-context-menu",
        config: {
          id: "translate-web-page",
          title: "Restore original",
          contexts: ["page", "frame"],
        },
      },
    ]);

    executeContextMenuEffects(contextMenuEffects, {
      removeContextMenu,
      createContextMenu,
    });

    expect(removeContextMenu).toHaveBeenCalledWith("translate-web-page", undefined);
    expect(createContextMenu).toHaveBeenCalledWith({
      id: "translate-web-page",
      title: "Restore original",
      contexts: ["page", "frame"],
    }, undefined);

    const iconUpdate = resolveIconUpdateFromRuntimeMessage(request, sender.tab.id);
    expect(iconUpdate).toEqual({
      nextPageLanguageState: "translated",
      updateTabId: 18,
    });

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

  it("skips active-tab state updates for inactive senders while still refreshing menu and icon", () => {
    const request = {
      action: "setPageLanguageState",
      pageLanguageState: "original",
    };
    const sender = {
      tab: {
        id: 9,
        url: "https://example.com/docs",
        active: false,
      },
    };

    expect(resolveActiveTabTranslationInfoMessageUpdate(request, sender)).toBeNull();

    expect(buildTranslatePageContextMenuRefreshPlan({
      isEnabled: true,
      pageLanguageState: request.pageLanguageState,
      restoreLabel: "Restore original",
      targetLanguageName: "French",
      buildTranslateForLabel: (languageName) => `Translate to ${languageName}`,
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

    const iconUpdate = resolveIconUpdateFromRuntimeMessage(request, sender.tab.id);
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
        tabId: 9,
        forceShow: false,
      },
      {
        type: "set-page-action-icon",
        tabId: 9,
        path: {
          fillOpacity: "0.5",
          fillColor: "#222222",
        },
      },
      {
        type: "hide-page-action",
        tabId: 9,
      },
      {
        type: "set-action-icon",
        tabId: 9,
        path: "/icons/icon-32.png",
      },
    ]);
  });
});