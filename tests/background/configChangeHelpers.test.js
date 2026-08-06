import { describe, expect, it } from "vitest";
import {
  resolveActionConfigChange,
  shouldRefreshIconsForConfigChange,
} from "../../src/background/configChangeHelpers.js";

describe("configChangeHelpers", () => {
  it("resolves popup-related config changes for browser and page action resets", () => {
    expect(resolveActionConfigChange("useOldPopup")).toEqual({
      resetBrowserAction: true,
      resetActivePageAction: false,
    });
    expect(resolveActionConfigChange("translateClickingOnce")).toEqual({
      resetBrowserAction: true,
      resetActivePageAction: true,
    });
  });

  it("returns no action resets for unrelated config changes", () => {
    expect(resolveActionConfigChange("targetLanguage")).toEqual({
      resetBrowserAction: false,
      resetActivePageAction: false,
    });
  });

  it("refreshes icons only for icon-relevant config changes", () => {
    expect(shouldRefreshIconsForConfigChange("useOldPopup")).toBe(true);
    expect(shouldRefreshIconsForConfigChange("showButtonInTheAddressBar")).toBe(true);
    expect(shouldRefreshIconsForConfigChange("translateClickingOnce")).toBe(false);
  });
});