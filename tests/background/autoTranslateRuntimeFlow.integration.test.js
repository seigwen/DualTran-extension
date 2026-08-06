import { describe, expect, it } from "vitest";
import {
  resolveAutoTranslateAlarmDispatch,
  resolveAutoTranslateConfigChange,
  resolveAutoTranslatePermissionBootstrap,
  shouldDisableAutoTranslateForRemovedPermissions,
} from "../../src/background/autoTranslateRuntimeHelpers.js";
import {
  buildAutoTranslateAlarmExecutionPlan,
  buildAutoTranslateConfigToggleEffects,
  buildAutoTranslatePermissionBootstrapEffects,
  buildAutoTranslatePermissionRemovedEffects,
} from "../../src/background/autoTranslateRuntimeExecutionHelpers.js";

describe("auto-translate runtime flow integration", () => {
  it("combines alarm dispatch resolution with send-message execution effects", () => {
    const dispatch = resolveAutoTranslateAlarmDispatch(
      { name: "alarmAutoTranslate" },
      { tabToAutoTranslate: 18 }
    );

    expect(buildAutoTranslateAlarmExecutionPlan(dispatch)).toEqual([
      {
        type: "send-tab-message",
        tabId: 18,
        message: { action: "autoTranslateBecauseClickedALink" },
        options: { frameId: 0 },
      },
    ]);
  });

  it("combines config and permission decisions with toggle and set-config effects", () => {
    expect(buildAutoTranslateConfigToggleEffects(
      resolveAutoTranslateConfigChange("autoTranslateWhenClickingALink", "yes")
    )).toEqual([
      { type: "toggle-auto-translate", action: "enable" },
    ]);

    expect(buildAutoTranslatePermissionRemovedEffects(
      shouldDisableAutoTranslateForRemovedPermissions({ permissions: ["tabs", "webNavigation"] })
    )).toEqual([
      {
        type: "set-config",
        key: "autoTranslateWhenClickingALink",
        value: "no",
      },
    ]);

    expect(buildAutoTranslatePermissionBootstrapEffects(
      resolveAutoTranslatePermissionBootstrap({
        hasPermissions: false,
        autoTranslateWhenClickingALink: "yes",
      })
    )).toEqual([
      {
        type: "set-config",
        key: "autoTranslateWhenClickingALink",
        value: "no",
      },
    ]);
  });
});