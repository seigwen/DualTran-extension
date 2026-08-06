import { describe, expect, it } from "vitest";
import {
  buildAutoTranslateResetState,
  resolveAutoTranslateAlarmDispatch,
  resolveAutoTranslateConfigChange,
  resolveAutoTranslatePermissionBootstrap,
  shouldDisableAutoTranslateForRemovedPermissions,
} from "../../src/background/autoTranslateRuntimeHelpers.js";

describe("autoTranslateRuntimeHelpers", () => {
  it("builds the reset state for auto-translate link tracking", () => {
    expect(buildAutoTranslateResetState()).toEqual({
      activeTabTranslationInfo: {},
      sitesToAutoTranslate: {},
    });
  });

  it("resolves alarm dispatch only for alarmAutoTranslate with a stored tab id", () => {
    expect(
      resolveAutoTranslateAlarmDispatch(
        { name: "alarmAutoTranslate" },
        { tabToAutoTranslate: 18 }
      )
    ).toEqual({
      tabId: 18,
      message: {
        action: "autoTranslateBecauseClickedALink",
      },
      frameId: 0,
    });

    expect(
      resolveAutoTranslateAlarmDispatch(
        { name: "other" },
        { tabToAutoTranslate: 18 }
      )
    ).toBeNull();

    expect(
      resolveAutoTranslateAlarmDispatch(
        { name: "alarmAutoTranslate" },
        {}
      )
    ).toBeNull();
  });

  it("maps config changes to enable or disable actions only for the relevant key", () => {
    expect(resolveAutoTranslateConfigChange("autoTranslateWhenClickingALink", "yes")).toBe("enable");
    expect(resolveAutoTranslateConfigChange("autoTranslateWhenClickingALink", "no")).toBe("disable");
    expect(resolveAutoTranslateConfigChange("targetLanguage", "fr")).toBeNull();
  });

  it("detects removed webNavigation permission", () => {
    expect(
      shouldDisableAutoTranslateForRemovedPermissions({
        permissions: ["tabs", "webNavigation"],
      })
    ).toBe(true);

    expect(
      shouldDisableAutoTranslateForRemovedPermissions({
        permissions: ["tabs"],
      })
    ).toBe(false);
  });

  it("resolves bootstrap behavior from permission state and config", () => {
    expect(
      resolveAutoTranslatePermissionBootstrap({
        hasPermissions: true,
        autoTranslateWhenClickingALink: "yes",
      })
    ).toEqual({
      action: "enable",
    });

    expect(
      resolveAutoTranslatePermissionBootstrap({
        hasPermissions: false,
        autoTranslateWhenClickingALink: "yes",
      })
    ).toEqual({
      action: "force-disable-config",
      configValue: "no",
    });
  });
});