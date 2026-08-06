import { describe, expect, it } from "vitest";
import {
  collectTabIds,
  resolveDesktopToggleTranslationMessage,
  resolveMobileActionClickMessage,
  resolveMobilePageActionUpdate,
} from "../../src/background/actionClickHelpers.js";

describe("actionClickHelpers", () => {
  it("returns a desktop toggle message only when translateClickingOnce is enabled", () => {
    expect(resolveDesktopToggleTranslationMessage("yes")).toEqual({
      action: "toggle-translation",
    });
    expect(resolveDesktopToggleTranslationMessage("no")).toBeNull();
  });

  it("returns the mobile popup message", () => {
    expect(resolveMobileActionClickMessage()).toEqual({
      action: "showPopupMobile",
    });
  });

  it("hides the mobile pageAction only while a tab is loading", () => {
    expect(resolveMobilePageActionUpdate("loading")).toBe("hide");
    expect(resolveMobilePageActionUpdate("complete")).toBe("noop");
  });

  it("collects tab ids from query results", () => {
    expect(collectTabIds([{ id: 3 }, { id: 18 }, { id: 24 }])).toEqual([3, 18, 24]);
    expect(collectTabIds()).toEqual([]);
  });
});