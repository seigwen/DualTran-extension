import { describe, expect, it, vi } from "vitest";
import {
  executeAutoTranslateAlarm,
  buildAutoTranslateAlarmExecutionPlan,
  buildAutoTranslateConfigToggleEffects,
  createAutoTranslateRuntimeEffectExecutor,
  createAutoTranslateToggleInvoker,
  executeAutoTranslatePermissionBootstrap,
  buildAutoTranslatePermissionBootstrapEffects,
  buildAutoTranslatePermissionRemovedEffects,
  executeAutoTranslateRuntimeEffects,
} from "../../src/background/autoTranslateRuntimeExecutionHelpers.js";

describe("autoTranslateRuntimeExecutionHelpers", () => {
  it("builds an alarm execution plan only when dispatch is present", () => {
    expect(buildAutoTranslateAlarmExecutionPlan({
      tabId: 9,
      message: { action: "autoTranslateBecauseClickedALink" },
      frameId: 0,
    })).toEqual([
      {
        type: "send-tab-message",
        tabId: 9,
        message: { action: "autoTranslateBecauseClickedALink" },
        options: { frameId: 0 },
      },
    ]);

    expect(buildAutoTranslateAlarmExecutionPlan(null)).toEqual([]);
  });

  it("loads tabToAutoTranslate before dispatching alarm tab effects", async () => {
    const getStorage = vi.fn(async () => ({
      tabToAutoTranslate: 9,
    }));
    const applyTabEffects = vi.fn();

    await expect(
      executeAutoTranslateAlarm(
        { name: "alarmAutoTranslate" },
        {
          getStorage,
          applyTabEffects,
        }
      )
    ).resolves.toEqual({
      tabId: 9,
      message: {
        action: "autoTranslateBecauseClickedALink",
      },
      frameId: 0,
    });

    expect(getStorage).toHaveBeenCalledWith(["tabToAutoTranslate"]);
    expect(applyTabEffects).toHaveBeenCalledWith([
      {
        type: "send-tab-message",
        tabId: 9,
        message: { action: "autoTranslateBecauseClickedALink" },
        options: { frameId: 0 },
      },
    ]);
  });

  it("maps config changes into toggle effects only for enable and disable", () => {
    expect(buildAutoTranslateConfigToggleEffects("enable")).toEqual([
      { type: "toggle-auto-translate", action: "enable" },
    ]);
    expect(buildAutoTranslateConfigToggleEffects("disable")).toEqual([
      { type: "toggle-auto-translate", action: "disable" },
    ]);
    expect(buildAutoTranslateConfigToggleEffects(null)).toEqual([]);
  });

  it("maps removed permissions into a forced config reset only when needed", () => {
    expect(buildAutoTranslatePermissionRemovedEffects(true)).toEqual([
      {
        type: "set-config",
        key: "autoTranslateWhenClickingALink",
        value: "no",
      },
    ]);

    expect(buildAutoTranslatePermissionRemovedEffects(false)).toEqual([]);
  });

  it("maps startup permission bootstrap into enable or force-disable effects", () => {
    expect(buildAutoTranslatePermissionBootstrapEffects({ action: "enable" })).toEqual([
      { type: "toggle-auto-translate", action: "enable" },
    ]);

    expect(buildAutoTranslatePermissionBootstrapEffects({
      action: "force-disable-config",
      configValue: "no",
    })).toEqual([
      {
        type: "set-config",
        key: "autoTranslateWhenClickingALink",
        value: "no",
      },
    ]);

    expect(buildAutoTranslatePermissionBootstrapEffects(null)).toEqual([]);
  });

  it("queries startup permissions before dispatching bootstrap effects", async () => {
    const containsPermissions = vi.fn((permissions, callback) => {
      expect(permissions).toEqual({
        permissions: ["webNavigation"],
      });
      callback(false);
    });
    const executeEffects = vi.fn();

    await expect(
      executeAutoTranslatePermissionBootstrap({
        containsPermissions,
        autoTranslateWhenClickingALink: "yes",
        executeEffects,
      })
    ).resolves.toEqual({
      action: "force-disable-config",
      configValue: "no",
    });

    expect(executeEffects).toHaveBeenCalledWith([
      {
        type: "set-config",
        key: "autoTranslateWhenClickingALink",
        value: "no",
      },
    ]);

    await expect(executeAutoTranslatePermissionBootstrap()).resolves.toBeNull();
  });

  it("executes toggle-auto-translate and set-config effects", () => {
    const toggleAutoTranslate = vi.fn();
    const setConfig = vi.fn();

    executeAutoTranslateRuntimeEffects([
      { type: "toggle-auto-translate", action: "enable" },
      {
        type: "set-config",
        key: "autoTranslateWhenClickingALink",
        value: "no",
      },
    ], {
      toggleAutoTranslate,
      setConfig,
    });

    expect(toggleAutoTranslate).toHaveBeenCalledWith("enable");
    expect(setConfig).toHaveBeenCalledWith("autoTranslateWhenClickingALink", "no");
  });

  it("creates a runtime effect executor that binds toggle and config handlers", () => {
    const toggleAutoTranslate = vi.fn();
    const setConfig = vi.fn();
    const executeEffects = createAutoTranslateRuntimeEffectExecutor({
      toggleAutoTranslate,
      setConfig,
    });

    executeEffects([
      { type: "toggle-auto-translate", action: "disable" },
      {
        type: "set-config",
        key: "autoTranslateWhenClickingALink",
        value: "yes",
      },
    ]);

    expect(toggleAutoTranslate).toHaveBeenCalledWith("disable");
    expect(setConfig).toHaveBeenCalledWith("autoTranslateWhenClickingALink", "yes");
  });

  it("creates a toggle invoker that routes enable and disable actions to matching handlers", () => {
    const enable = vi.fn();
    const disable = vi.fn();

    const toggleAutoTranslate = createAutoTranslateToggleInvoker({
      toggles: {
        enable,
        disable,
      },
    });

    toggleAutoTranslate("enable");
    toggleAutoTranslate("disable");

    expect(enable).toHaveBeenCalledTimes(1);
    expect(disable).toHaveBeenCalledTimes(1);
  });

  it("ignores unknown toggle actions when creating the runtime toggle invoker", () => {
    const enable = vi.fn();
    const toggleAutoTranslate = createAutoTranslateToggleInvoker({
      toggles: { enable },
    });

    toggleAutoTranslate("pause");

    expect(enable).not.toHaveBeenCalled();
  });

  it("returns null when alarm dispatch cannot be evaluated", async () => {
    await expect(
      executeAutoTranslateAlarm(
        { name: "other" },
        {
          getStorage: vi.fn(async () => ({})),
          applyTabEffects: vi.fn(),
        }
      )
    ).resolves.toBeNull();

    await expect(
      executeAutoTranslateAlarm(
        { name: "alarmAutoTranslate" },
        {
          applyTabEffects: vi.fn(),
        }
      )
    ).resolves.toBeNull();
  });
});