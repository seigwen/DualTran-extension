import { describe, expect, it, vi } from "vitest";
import {
  resolveDesktopToggleTranslationMessage,
  resolveMobileActionClickMessage,
  resolveMobilePageActionUpdate,
} from "../../src/background/actionClickHelpers.js";
import {
  buildDesktopActionClickEffects,
  buildMobileActionClickEffects,
  createActionClickEffectExecutor,
  executeInitialPageActionHide,
  executeActionClickEffects,
} from "../../src/background/actionClickExecutionHelpers.js";

describe("action click dispatch loop integration", () => {
  it("combines mobile loading hides with the showPopupMobile dispatch path", () => {
    const hidePageAction = vi.fn();
    const sendTabMessage = vi.fn();
    const executeEffects = createActionClickEffectExecutor({
      hidePageAction,
      sendTabMessage,
    });

    expect(resolveMobilePageActionUpdate("loading")).toBe("hide");

    executeInitialPageActionHide({
      queryTabs(_queryInfo, callback) {
        callback([{ id: 3 }, { id: 18 }]);
      },
      applyEffects: executeEffects,
    });

    executeEffects(
      buildMobileActionClickEffects(18, resolveMobileActionClickMessage())
    );

    expect(hidePageAction.mock.calls).toEqual([[3], [18]]);
    expect(sendTabMessage).toHaveBeenCalledWith(
      18,
      { action: "showPopupMobile" },
      { frameId: 0 }
    );
  });

  it("dispatches desktop toggle clicks only when translate-clicking-once is enabled", () => {
    const sendTabMessage = vi.fn();
    const executeEffects = createActionClickEffectExecutor({ sendTabMessage });

    executeEffects(
      buildDesktopActionClickEffects(11, resolveDesktopToggleTranslationMessage("yes"))
    );
    executeEffects(
      buildDesktopActionClickEffects(11, resolveDesktopToggleTranslationMessage("no"))
    );

    expect(sendTabMessage.mock.calls).toEqual([
      [11, { action: "toggle-translation" }],
    ]);
  });
});