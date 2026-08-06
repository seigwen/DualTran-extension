import { describe, expect, it, vi } from "vitest";
import {
  buildIconEffectPlan,
  resolveActionIconPath,
  resolveIconUpdateFromRuntimeMessage,
  resolveSvgIconAppearance,
} from "../../src/background/iconHelpers.js";
import { executeActivatedTabIconRefresh } from "../../src/background/iconExecutionHelpers.js";

describe("runtime icon flow integration", () => {
  it("combines activated-tab main-frame query with icon update planning", async () => {
    const sendTabMessage = vi.fn((tabId, payload, options, callback) => {
      callback("translated");
    });
    const setPageLanguageState = vi.fn();
    const applyIconUpdate = vi.fn();

    const update = await executeActivatedTabIconRefresh(
      18,
      {
        setPageLanguageState,
        applyIconUpdate,
        sendTabMessage,
      }
    );

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

    const pageActionIconPath = resolveSvgIconAppearance({
      pageLanguageState: update.nextPageLanguageState,
      popupBlueWhenSiteIsTranslated: "yes",
      themeColorAttention: "#ff5500",
    });
    const actionIconPath = resolveActionIconPath({
      pageLanguageState: update.nextPageLanguageState,
      popupBlueWhenSiteIsTranslated: "yes",
    });

    expect(buildIconEffectPlan({
      tabId: update.updateTabId,
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

  it("returns null for activated-tab refresh when the main-frame query bridge cannot run", async () => {
    const setPageLanguageState = vi.fn();
    const applyIconUpdate = vi.fn();

    await expect(
      executeActivatedTabIconRefresh(18, {
        setPageLanguageState,
        applyIconUpdate,
      })
    ).resolves.toBeNull();

    expect(setPageLanguageState).not.toHaveBeenCalled();
    expect(applyIconUpdate).not.toHaveBeenCalled();
  });

  it("combines runtime page-language messages with hidden pageAction icon planning", () => {
    const update = resolveIconUpdateFromRuntimeMessage(
      {
        action: "setPageLanguageState",
        pageLanguageState: "original",
      },
      9
    );

    expect(update).toEqual({
      nextPageLanguageState: "original",
      updateTabId: 9,
    });

    expect(buildIconEffectPlan({
      tabId: update.updateTabId,
      hasPageAction: true,
      hasAction: true,
      pageActionIconPath: "page-icon",
      actionIconPath: resolveActionIconPath({
        pageLanguageState: update.nextPageLanguageState,
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
        path: "page-icon",
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