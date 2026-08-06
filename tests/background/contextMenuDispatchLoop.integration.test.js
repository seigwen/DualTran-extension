import { describe, expect, it, vi } from "vitest";
import {
  buildTranslatePageContextMenuConfig,
  buildTranslateSelectedContextMenuConfig,
  getTranslatePageContextMenuTitle,
} from "../../src/background/contextMenuHelpers.js";
import {
  buildTranslatePageContextMenuEffects,
  buildTranslateSelectedContextMenuEffects,
  executeContextMenuEffects,
} from "../../src/background/contextMenuExecutionHelpers.js";

describe("context menu dispatch loop integration", () => {
  it("dispatches selected-text menu refresh through remove then create", () => {
    const removeContextMenu = vi.fn();
    const createContextMenu = vi.fn();

    const effects = buildTranslateSelectedContextMenuEffects(
      buildTranslateSelectedContextMenuConfig(true, "Translate selected text")
    );

    executeContextMenuEffects(effects, {
      removeContextMenu,
      createContextMenu,
    });

    expect(removeContextMenu.mock.calls).toEqual([
      ["translate-selected-text", undefined],
    ]);
    expect(createContextMenu.mock.calls).toEqual([
      [
        {
          id: "translate-selected-text",
          title: "Translate selected text",
          contexts: ["selection"],
        },
        undefined,
      ],
    ]);
  });

  it("dispatches translated-page menu refresh through remove then recreate with restore title", () => {
    const removeContextMenu = vi.fn();
    const createContextMenu = vi.fn();

    const title = getTranslatePageContextMenuTitle({
      pageLanguageState: "translated",
      restoreLabel: "Restore original",
      targetLanguageName: "French",
      buildTranslateForLabel: (languageName) => `Translate to ${languageName}`,
    });
    const effects = buildTranslatePageContextMenuEffects(
      buildTranslatePageContextMenuConfig(true, title)
    );

    executeContextMenuEffects(effects, {
      removeContextMenu,
      createContextMenu,
    });

    expect(removeContextMenu.mock.calls).toEqual([
      ["translate-web-page", undefined],
    ]);
    expect(createContextMenu.mock.calls).toEqual([
      [
        {
          id: "translate-web-page",
          title: "Restore original",
          contexts: ["page", "frame"],
        },
        undefined,
      ],
    ]);
  });
});