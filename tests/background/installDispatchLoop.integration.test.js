import { describe, expect, it, vi } from "vitest";
import {
  buildInstalledActionPlan,
} from "../../src/background/installHelpers.js";
import {
  buildInstalledExecutionPlan,
  createInstallEffectExecutor,
  executeDevelopmentReloadBootstrap,
  executeInstallEffects,
} from "../../src/background/installExecutionHelpers.js";
import { createTabEffectExecutor } from "../../src/background/tabExecutionHelpers.js";

describe("install dispatch loop integration", () => {
  it("dispatches update lifecycle effects through config, cache, and tab handlers", () => {
    const now = 1_700_000_000_000;
    const setConfig = vi.fn();
    const deleteTranslationCache = vi.fn();
    const createTab = vi.fn();
    const applyTabEffects = createTabEffectExecutor({ createTab });

    createInstallEffectExecutor({
      setConfig,
      deleteTranslationCache,
      applyTabEffects,
    })(
      buildInstalledExecutionPlan(
        buildInstalledActionPlan({
          reason: "update",
          currentVersion: "1.2.0",
          previousVersion: "1.1.0",
          isMobile: false,
          showReleaseNotes: "yes",
          lastTimeShowingReleaseNotes: now - 30 * 24 * 60 * 60 * 1000,
          optionsPageUrl: "chrome-extension://id/options/options.html",
          releaseNotesPageUrl: "chrome-extension://id/options/options.html#release_notes",
          now,
        })
      )
    );

    expect(setConfig).toHaveBeenCalledWith("lastTimeShowingReleaseNotes", now);
    expect(deleteTranslationCache).toHaveBeenCalledWith();
    expect(createTab).toHaveBeenCalledWith({
      url: "chrome-extension://id/options/options.html#release_notes",
    });
  });

  it("dispatches development reload effects through the shared tab handler", () => {
    const reloadTab = vi.fn();
    const executeReloadEffects = createInstallEffectExecutor({
      applyTabEffects: createTabEffectExecutor({ reloadTab }),
    });

    executeDevelopmentReloadBootstrap({
      reason: "install",
      getSelf(callback) {
        callback({ installType: "development" });
      },
      queryTabs(_queryInfo, callback) {
        callback([
          { id: 1, url: "https://example.com" },
          { id: 2, url: "http://example.org/page" },
          { id: 3, url: "chrome://extensions" },
        ]);
      },
      executeReloadEffects,
    });

    expect(reloadTab.mock.calls).toEqual([
      [1],
      [2],
    ]);
  });
});