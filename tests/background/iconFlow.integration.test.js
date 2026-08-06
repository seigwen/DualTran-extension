import { describe, expect, it } from "vitest";
import {
  buildAllTabIconRefreshPlan,
  buildIconEffectPlan,
  buildThemeIconRefreshPlan,
  resolveActionIconPath,
  resolveIconUpdateFromLanguageState,
  resolveIconUpdateOnTabActivated,
  resolveSvgIconAppearance,
} from "../../src/background/iconHelpers.js";

describe("icon flow integration", () => {
  it("combines tab activation refresh, language-state update, and icon effect planning", () => {
    expect(resolveIconUpdateOnTabActivated(18)).toEqual({
      nextPageLanguageState: "original",
      updateTabId: 18,
      queryMessage: {
        action: "getCurrentPageLanguageState",
      },
      frameId: 0,
    });

    const languageUpdate = resolveIconUpdateFromLanguageState("translated", 18);
    const pageActionIconPath = resolveSvgIconAppearance({
      pageLanguageState: languageUpdate.nextPageLanguageState,
      popupBlueWhenSiteIsTranslated: "yes",
      themeColorAttention: "#ff5500",
    });
    const actionIconPath = resolveActionIconPath({
      pageLanguageState: languageUpdate.nextPageLanguageState,
      popupBlueWhenSiteIsTranslated: "yes",
    });

    expect(buildIconEffectPlan({
      tabId: languageUpdate.updateTabId,
      hasPageAction: true,
      hasAction: true,
      pageActionIconPath,
      actionIconPath,
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

  it("combines theme refresh planning with all-tab icon refresh targeting", () => {
    const themePlan = buildThemeIconRefreshPlan({
      theme: {
        colors: {
          toolbar_field_text: "#222222",
          icons_attention: "#00aaff",
        },
      },
    });

    expect(themePlan).toEqual({
      themeColorFieldText: "#222222",
      themeColorAttention: "#00aaff",
      shouldRefreshAllTabs: true,
    });

    expect(buildAllTabIconRefreshPlan([
      { id: 3 },
      { id: 18 },
      { url: "https://example.com" },
    ])).toEqual([3, 18]);
  });
});