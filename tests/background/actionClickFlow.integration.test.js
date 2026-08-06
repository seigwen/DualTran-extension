import { describe, expect, it } from "vitest";
import {
  collectTabIds,
  resolveDesktopToggleTranslationMessage,
  resolveMobileActionClickMessage,
  resolveMobilePageActionUpdate,
} from "../../src/background/actionClickHelpers.js";
import {
  buildDesktopActionClickEffects,
  buildMobileActionClickEffects,
  buildPageActionHideEffects,
} from "../../src/background/actionClickExecutionHelpers.js";

describe("action click flow integration", () => {
  it("combines mobile pageAction hide and popup dispatch flows", () => {
    const tabIds = collectTabIds([{ id: 3 }, { id: 18 }]);
    expect(buildPageActionHideEffects(tabIds)).toEqual([
      { type: "hide-page-action", tabId: 3 },
      { type: "hide-page-action", tabId: 18 },
    ]);

    expect(resolveMobilePageActionUpdate("loading")).toBe("hide");
    expect(buildMobileActionClickEffects(18, resolveMobileActionClickMessage())).toEqual([
      {
        type: "send-tab-message",
        tabId: 18,
        message: { action: "showPopupMobile" },
        options: { frameId: 0 },
      },
    ]);
  });

  it("combines desktop toggle decision with send-message execution effects", () => {
    const action = resolveDesktopToggleTranslationMessage("yes");
    expect(buildDesktopActionClickEffects(18, action)).toEqual([
      {
        type: "send-tab-message",
        tabId: 18,
        message: { action: "toggle-translation" },
      },
    ]);

    expect(buildDesktopActionClickEffects(18, resolveDesktopToggleTranslationMessage("no"))).toEqual([]);
  });
});