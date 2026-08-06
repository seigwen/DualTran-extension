import { describe, expect, it } from "vitest";
import {
  buildAllTabIconRefreshPlan,
  buildIconEffectPlan,
  buildThemeIconRefreshPlan,
  resolveActionIconPath,
  resolveIconUpdateFromLanguageState,
  resolveIconUpdateFromRuntimeMessage,
  resolveIconUpdateOnTabActivated,
  resolveIconUpdateOnTabLoading,
  resolvePageActionVisibility,
  resolveTabIncognitoState,
  resolveThemeColorState,
  resolveSvgIconAppearance,
} from "../../src/background/iconHelpers.js";

describe("iconHelpers", () => {
  it("resolves the action icon path from page language state and translation highlight setting", () => {
    expect(
      resolveActionIconPath({
        pageLanguageState: "translated",
        popupBlueWhenSiteIsTranslated: "yes",
      })
    ).toBe("/icons/icon-32-translated.png");

    expect(
      resolveActionIconPath({
        pageLanguageState: "original",
        popupBlueWhenSiteIsTranslated: "yes",
      })
    ).toBe("/icons/icon-32.png");
  });

  it("resolves whether pageAction should be shown or hidden", () => {
    expect(resolvePageActionVisibility("no")).toBe("hide");
    expect(resolvePageActionVisibility("yes")).toBe("show");
  });

  it("resolves tab incognito state and builds icon effect plans in execution order", () => {
    expect(resolveTabIncognitoState([
      { id: 3, incognito: false },
      { id: 18, incognito: true },
    ], 18)).toBe(true);
    expect(resolveTabIncognitoState([], 18)).toBe(false);

    expect(buildIconEffectPlan({
      tabId: 18,
      hasPageAction: true,
      hasAction: true,
      pageActionIconPath: "data:image/svg+xml;base64,abc",
      actionIconPath: "/icons/icon-32-translated.png",
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
        path: "data:image/svg+xml;base64,abc",
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

    expect(buildIconEffectPlan({
      tabId: 18,
      hasPageAction: true,
      hasAction: false,
      pageActionIconPath: "icon",
      actionIconPath: "unused",
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
        path: "icon",
      },
      {
        type: "hide-page-action",
        tabId: 18,
      },
    ]);
  });

  it("builds the all-tab icon refresh plan from query results", () => {
    expect(buildAllTabIconRefreshPlan([
      { id: 3 },
      { id: 18 },
      { url: "https://example.com" },
    ])).toEqual([3, 18]);
  });

  it("extracts theme colors and builds a theme-triggered icon refresh plan", () => {
    expect(resolveThemeColorState({
      colors: {
        toolbar_field_text: "#111111",
        icons_attention: "#ff5500",
      },
    })).toEqual({
      themeColorFieldText: "#111111",
      themeColorAttention: "#ff5500",
    });

    expect(resolveThemeColorState({
      theme: {
        colors: {
          toolbar_field_text: "#222222",
        },
      },
    })).toEqual({
      themeColorFieldText: "#222222",
      themeColorAttention: null,
    });

    expect(buildThemeIconRefreshPlan({
      theme: {
        colors: {
          icons_attention: "#00aaff",
        },
      },
    })).toEqual({
      themeColorFieldText: null,
      themeColorAttention: "#00aaff",
      shouldRefreshAllTabs: true,
    });
  });

  it("prefers theme attention color for translated SVG icons", () => {
    expect(
      resolveSvgIconAppearance({
        pageLanguageState: "translated",
        popupBlueWhenSiteIsTranslated: "yes",
        themeColorAttention: "#ff5500",
      })
    ).toEqual({
      fillOpacity: "1.0",
      fillColor: "#ff5500",
    });
  });

  it("falls back to translated accent colors and regular field text colors", () => {
    expect(
      resolveSvgIconAppearance({
        pageLanguageState: "translated",
        popupBlueWhenSiteIsTranslated: "yes",
        incognito: true,
      })
    ).toEqual({
      fillOpacity: "1.0",
      fillColor: "#00ddff",
    });

    expect(
      resolveSvgIconAppearance({
        pageLanguageState: "original",
        popupBlueWhenSiteIsTranslated: "yes",
        themeColorFieldText: "#333333",
      })
    ).toEqual({
      fillOpacity: "0.5",
      fillColor: "#333333",
    });
  });

  it("falls back to black or white SVG colors when theme colors are unavailable", () => {
    expect(
      resolveSvgIconAppearance({
        pageLanguageState: "original",
        popupBlueWhenSiteIsTranslated: "no",
      })
    ).toEqual({
      fillOpacity: "0.5",
      fillColor: "black",
    });

    expect(
      resolveSvgIconAppearance({
        pageLanguageState: "original",
        popupBlueWhenSiteIsTranslated: "no",
        darkMode: true,
      })
    ).toEqual({
      fillOpacity: "0.5",
      fillColor: "white",
    });
  });

  it("resolves icon refresh state when a tab starts loading", () => {
    expect(resolveIconUpdateOnTabLoading("loading")).toEqual({
      nextPageLanguageState: "original",
    });
    expect(resolveIconUpdateOnTabLoading("complete")).toBeNull();
  });

  it("builds the activated-tab refresh plan and language-state updates", () => {
    expect(resolveIconUpdateOnTabActivated(18)).toEqual({
      nextPageLanguageState: "original",
      updateTabId: 18,
      queryMessage: {
        action: "getCurrentPageLanguageState",
      },
      frameId: 0,
    });

    expect(resolveIconUpdateFromLanguageState("translated", 18)).toEqual({
      nextPageLanguageState: "translated",
      updateTabId: 18,
    });
    expect(resolveIconUpdateFromLanguageState(undefined, 18)).toBeNull();
  });

  it("resolves runtime page-language messages into icon updates", () => {
    expect(
      resolveIconUpdateFromRuntimeMessage(
        {
          action: "setPageLanguageState",
          pageLanguageState: "translated",
        },
        18
      )
    ).toEqual({
      nextPageLanguageState: "translated",
      updateTabId: 18,
    });

    expect(
      resolveIconUpdateFromRuntimeMessage(
        {
          action: "other",
        },
        18
      )
    ).toBeNull();
  });
});