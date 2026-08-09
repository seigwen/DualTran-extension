import { describe, expect, it, vi } from "vitest";
import { queryMainFrame } from "../../src/background/runtimeMessageHelpers.js";
import {
  buildTranslatePageContextMenuRefreshPlan,
  executeActivatedContextMenuRefresh,
} from "../../src/background/contextMenuExecutionHelpers.js";
import {
  buildIconEffectPlan,
  resolveActionIconPath,
  resolveIconUpdateFromLanguageState,
  resolveIconUpdateOnTabActivated,
  resolveSvgIconAppearance,
} from "../../src/background/iconHelpers.js";

describe("tab activated ui flow integration", () => {
  it("combines activated-tab context menu refresh with icon refresh", async () => {
    const sendTabMessage = vi.fn()
      .mockImplementationOnce((tabId, payload, options, callback) => {
        callback("translated");
      })
      .mockImplementationOnce((tabId, payload, options, callback) => {
        callback("translated");
      });

    const iconActivation = resolveIconUpdateOnTabActivated(18);
    const applyContextMenuRefresh = vi.fn();

    expect(buildTranslatePageContextMenuRefreshPlan({
      isEnabled: true,
      pageLanguageState: "original",
      restoreLabel: "Restore original",
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

    expect(buildIconEffectPlan({
      tabId: iconActivation.updateTabId,
      hasPageAction: true,
      hasAction: true,
      pageActionIconPath: resolveSvgIconAppearance({
        pageLanguageState: iconActivation.nextPageLanguageState,
        popupBlueWhenSiteIsTranslated: "yes",
        themeColorFieldText: "#222222",
        themeColorAttention: "#ff5500",
      }),
      actionIconPath: resolveActionIconPath({
        pageLanguageState: iconActivation.nextPageLanguageState,
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
          fillOpacity: "0.5",
          fillColor: "#222222",
        },
      },
      {
        type: "show-page-action",
        tabId: 18,
      },
      {
        type: "set-action-icon",
        tabId: 18,
        path: "/icons/icon-32.png",
      },
    ]);

    await expect(
      executeActivatedContextMenuRefresh(18, {
        applyContextMenuRefresh,
        sendTabMessage,
      })
    ).resolves.toEqual({
      pageLanguageState: "translated",
    });

    expect(applyContextMenuRefresh.mock.calls).toEqual([
      ["original"],
      ["translated"],
    ]);

    expect(buildTranslatePageContextMenuRefreshPlan({
      isEnabled: true,
      pageLanguageState: applyContextMenuRefresh.mock.calls.at(-1)[0],
      restoreLabel: "Restore original",
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
          title: "Restore original",
          contexts: ["page", "frame"],
        },
      },
    ]);

    const iconResponse = await queryMainFrame(
      iconActivation.updateTabId,
      iconActivation.queryMessage.action,
      sendTabMessage
    );
    const resolvedIconUpdate = resolveIconUpdateFromLanguageState(
      iconResponse,
      iconActivation.updateTabId
    );

    expect(buildIconEffectPlan({
      tabId: resolvedIconUpdate.updateTabId,
      hasPageAction: true,
      hasAction: true,
      pageActionIconPath: resolveSvgIconAppearance({
        pageLanguageState: resolvedIconUpdate.nextPageLanguageState,
        popupBlueWhenSiteIsTranslated: "yes",
        themeColorFieldText: "#222222",
        themeColorAttention: "#ff5500",
      }),
      actionIconPath: resolveActionIconPath({
        pageLanguageState: resolvedIconUpdate.nextPageLanguageState,
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

    expect(sendTabMessage).toHaveBeenNthCalledWith(
      1,
      18,
      { action: "getCurrentPageLanguageState" },
      { frameId: 0 },
      expect.any(Function)
    );
    expect(sendTabMessage).toHaveBeenNthCalledWith(
      2,
      18,
      { action: "getCurrentPageLanguageState" },
      { frameId: 0 },
      expect.any(Function)
    );
  });
});