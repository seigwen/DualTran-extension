import { describe, expect, it } from "vitest";
import {
  buildTranslatePageContextMenuConfig,
  buildTranslateSelectedContextMenuConfig,
  getTranslatePageContextMenuTitle,
} from "../../src/background/contextMenuHelpers.js";
import {
  buildTranslatePageContextMenuEffects,
  buildTranslateSelectedContextMenuEffects,
} from "../../src/background/contextMenuExecutionHelpers.js";

describe("context menu flow integration", () => {
  it("combines selected-text menu config resolution with refresh execution effects", () => {
    const config = buildTranslateSelectedContextMenuConfig(true, "Translate selected text");

    expect(buildTranslateSelectedContextMenuEffects(config)).toEqual([
      { type: "remove-context-menu", menuId: "translate-selected-text" },
      {
        type: "create-context-menu",
        config: {
          id: "translate-selected-text",
          title: "Translate selected text",
          contexts: ["selection"],
        },
      },
    ]);
  });

  it("combines page-language title resolution with page menu refresh execution effects", () => {
    const title = getTranslatePageContextMenuTitle({
      pageLanguageState: "translated",
      restoreLabel: "Restore original",
      targetLanguageName: "French",
      buildTranslateForLabel: (languageName) => `Translate to ${languageName}`,
    });
    const config = buildTranslatePageContextMenuConfig(true, title);

    expect(buildTranslatePageContextMenuEffects(config)).toEqual([
      { type: "remove-context-menu", menuId: "translate-web-page" },
      {
        type: "create-context-menu",
        config: {
          id: "translate-web-page",
          title: "Restore original",
          contexts: ["page", "frame"],
        },
      },
    ]);
  });
});