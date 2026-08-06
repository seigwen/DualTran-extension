import { describe, expect, it, vi } from "vitest";
import {
  resolveAutoTranslateConfigChange,
  resolveAutoTranslatePermissionBootstrap,
  shouldDisableAutoTranslateForRemovedPermissions,
} from "../../src/background/autoTranslateRuntimeHelpers.js";
import {
  buildAutoTranslateConfigToggleEffects,
  createAutoTranslateRuntimeEffectExecutor,
  createAutoTranslateToggleInvoker,
  buildAutoTranslatePermissionBootstrapEffects,
  buildAutoTranslatePermissionRemovedEffects,
  executeAutoTranslateAlarm,
  executeAutoTranslatePermissionBootstrap,
} from "../../src/background/autoTranslateRuntimeExecutionHelpers.js";
import { createTabEffectExecutor } from "../../src/background/tabExecutionHelpers.js";

describe("auto-translate runtime dispatch loop integration", () => {
  it("dispatches config toggles and permission bootstrap through runtime effect handlers", () => {
    const toggleCalls = [];
    const toggleAutoTranslate = createAutoTranslateToggleInvoker({
      toggles: {
        enable() {
          toggleCalls.push("enable");
        },
        disable() {
          toggleCalls.push("disable");
        },
      },
    });
    const setConfig = vi.fn();

    const executeEffects = createAutoTranslateRuntimeEffectExecutor({ toggleAutoTranslate, setConfig });

    executeEffects(
      buildAutoTranslateConfigToggleEffects(
        resolveAutoTranslateConfigChange("autoTranslateWhenClickingALink", "yes")
      )
    );

    executeEffects(
      buildAutoTranslatePermissionBootstrapEffects(
        resolveAutoTranslatePermissionBootstrap({
          hasPermissions: false,
          autoTranslateWhenClickingALink: "yes",
        })
      )
    );

    expect(toggleCalls).toEqual(["enable"]);
    expect(setConfig.mock.calls).toEqual([
      ["autoTranslateWhenClickingALink", "no"],
    ]);
  });

  it("dispatches startup permission bootstrap through the shared runtime queried bridge", async () => {
    const toggleCalls = [];
    const toggleAutoTranslate = createAutoTranslateToggleInvoker({
      toggles: {
        enable() {
          toggleCalls.push("enable");
        },
      },
    });
    const setConfig = vi.fn();

    await expect(
      executeAutoTranslatePermissionBootstrap({
        containsPermissions(_permissions, callback) {
          callback(true);
        },
        autoTranslateWhenClickingALink: "yes",
        executeEffects(effects) {
          createAutoTranslateRuntimeEffectExecutor({ toggleAutoTranslate, setConfig })(effects);
        },
      })
    ).resolves.toEqual({
      action: "enable",
    });

    expect(toggleCalls).toEqual(["enable"]);
    expect(setConfig).not.toHaveBeenCalled();
  });

  it("dispatches removed-permission forced disable through the shared runtime executor", () => {
    const toggleAutoTranslate = vi.fn();
    const setConfig = vi.fn();

    createAutoTranslateRuntimeEffectExecutor({ toggleAutoTranslate, setConfig })(
      buildAutoTranslatePermissionRemovedEffects(
        shouldDisableAutoTranslateForRemovedPermissions({ permissions: ["tabs", "webNavigation"] })
      )
    );

    expect(toggleAutoTranslate).not.toHaveBeenCalled();
    expect(setConfig).toHaveBeenCalledWith("autoTranslateWhenClickingALink", "no");
  });

  it("dispatches alarm-driven auto-translate through the shared tab executor", async () => {
    const sendTabMessage = vi.fn();
    const applyTabEffects = createTabEffectExecutor({ sendTabMessage });

    await executeAutoTranslateAlarm(
      { name: "alarmAutoTranslate" },
      {
        getStorage: vi.fn(async () => ({
          tabToAutoTranslate: 14,
        })),
        applyTabEffects,
      }
    );

    expect(sendTabMessage).toHaveBeenCalledWith(
      14,
      { action: "autoTranslateBecauseClickedALink" },
      { frameId: 0 }
    );
  });
});