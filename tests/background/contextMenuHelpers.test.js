import { describe, expect, it } from "vitest";
import {
  buildTranslatePageContextMenuConfig,
  buildTranslateSelectedContextMenuConfig,
  getTranslatePageContextMenuTitle,
} from "../../src/background/contextMenuHelpers.js";

describe("contextMenuHelpers", () => {
  it("builds the selected-text context menu config only when enabled", () => {
    expect(buildTranslateSelectedContextMenuConfig(false, "Translate selection")).toBeNull();
    expect(buildTranslateSelectedContextMenuConfig(true, "Translate selection")).toEqual({
      id: "translate-selected-text",
      title: "Translate selection",
      contexts: ["selection"],
    });
  });

  it("returns the restore label when the page is already translated", () => {
    expect(
      getTranslatePageContextMenuTitle({
        pageLanguageState: "translated",
        restoreLabel: "Restore",
        targetLanguageName: "French",
        buildTranslateForLabel: (languageName) => `Translate to ${languageName}`,
      })
    ).toBe("Restore");
  });

  it("builds the translate-for label when the page is in original state", () => {
    expect(
      getTranslatePageContextMenuTitle({
        pageLanguageState: "original",
        restoreLabel: "Restore",
        targetLanguageName: "French",
        buildTranslateForLabel: (languageName) => `Translate to ${languageName}`,
      })
    ).toBe("Translate to French");
  });

  it("builds the page context menu config only when enabled", () => {
    expect(buildTranslatePageContextMenuConfig(false, "Translate to French")).toBeNull();
    expect(buildTranslatePageContextMenuConfig(true, "Translate to French")).toEqual({
      id: "translate-web-page",
      title: "Translate to French",
      contexts: ["page", "frame"],
    });
  });
});