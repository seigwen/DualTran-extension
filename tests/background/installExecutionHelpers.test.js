import { describe, expect, it, vi } from "vitest";
import {
  buildDevelopmentReloadExecutionPlan,
  buildInstalledExecutionPlan,
  buildStartupExecutionPlan,
  createInstallEffectExecutor,
  executeDevelopmentReloadBootstrap,
  executeInstallEffects,
} from "../../src/background/installExecutionHelpers.js";
describe("installExecutionHelpers", () => {
  it("builds startup storage write effects for both tab maps", () => {
    expect(buildStartupExecutionPlan({
      tabToMimeType: {},
      tabHasContentScript: {},
    })).toEqual([
      {
        type: "set-storage",
        update: {
          tabToMimeType: {},
        },
        logMessage: "tabToMimeType write succeeded [object Object]",
      },
      {
        type: "set-storage",
        update: {
          tabHasContentScript: {},
        },
        logMessage: "tabHasContentScript write succeeded [object Object]",
      },
    ]);
  });

  it("returns no effects when startup reset payload is missing", () => {
    expect(buildStartupExecutionPlan(null)).toEqual([]);
  });

  it("builds install/update execution effects for config, page open, and cache deletion", () => {
    expect(buildInstalledExecutionPlan({
      shouldSetLastTimeShowingReleaseNotes: true,
      nextLastTimeShowingReleaseNotes: 123,
      openPageUrl: "chrome-extension://id/options/options.html#release_notes",
      shouldDeleteTranslationCache: true,
      shouldDisableDeepL: true,
    })).toEqual([
      {
        type: "set-config",
        key: "lastTimeShowingReleaseNotes",
        value: 123,
      },
      {
        type: "open-tab",
        url: "chrome-extension://id/options/options.html#release_notes",
      },
      {
        type: "delete-translation-cache",
      },
      {
        type: "set-config",
        key: "enableDeepL",
        value: "no",
      },
    ]);
  });

  it("omits install/update effects that are not requested by the plan", () => {
    expect(buildInstalledExecutionPlan({
      shouldSetLastTimeShowingReleaseNotes: false,
      openPageUrl: null,
      shouldDeleteTranslationCache: false,
      shouldDisableDeepL: false,
    })).toEqual([]);
  });

  it("builds development reload effects from tab ids", () => {
    expect(buildDevelopmentReloadExecutionPlan([1, 2])).toEqual([
      { type: "reload-tab", tabId: 1 },
      { type: "reload-tab", tabId: 2 },
    ]);

    expect(buildDevelopmentReloadExecutionPlan([])).toEqual([]);
  });

  it("bootstraps development reload effects from management self info and queried tabs", () => {
    const getSelf = vi.fn((callback) => {
      callback({ installType: "development" });
    });
    const queryTabs = vi.fn((queryInfo, callback) => {
      callback([
        { id: 1, url: "https://example.com" },
        { id: 2, url: "chrome://extensions" },
      ]);
    });
    const executeReloadEffects = vi.fn();

    executeDevelopmentReloadBootstrap({
      reason: "install",
      getSelf,
      queryTabs,
      executeReloadEffects,
    });

    expect(getSelf).toHaveBeenCalledWith(expect.any(Function));
    expect(queryTabs).toHaveBeenCalledWith({}, expect.any(Function));
    expect(executeReloadEffects).toHaveBeenCalledWith([
      { type: "reload-tab", tabId: 1 },
    ]);
  });

  it("skips development reload bootstrap on runtime errors, missing self, or unsupported reasons", () => {
    const getSelf = vi.fn((callback) => {
      callback({ installType: "development" });
    });
    const queryTabs = vi.fn((queryInfo, callback) => {
      callback([{ id: 1, url: "https://example.com" }]);
    });
    const executeReloadEffects = vi.fn();

    executeDevelopmentReloadBootstrap({
      reason: "chrome_update",
      getSelf,
      queryTabs,
      executeReloadEffects,
    });

    executeDevelopmentReloadBootstrap({
      reason: "install",
      getSelf(callback) {
        callback(null);
      },
      queryTabs,
      executeReloadEffects,
    });

    let callCount = 0;
    executeDevelopmentReloadBootstrap({
      reason: "update",
      getSelf,
      queryTabs,
      hasRuntimeError() {
        callCount += 1;
        return callCount === 1;
      },
      executeReloadEffects,
    });

    expect(queryTabs).not.toHaveBeenCalled();
    expect(executeReloadEffects).not.toHaveBeenCalled();
  });

  it("executes config, cache, and tab effects through the shared install executor", () => {
    const setConfig = vi.fn();
    const deleteTranslationCache = vi.fn();
    const executeTabEffect = vi.fn();

    executeInstallEffects([
      {
        type: "set-config",
        key: "enableDeepL",
        value: "no",
      },
      {
        type: "delete-translation-cache",
      },
      {
        type: "open-tab",
        url: "chrome-extension://id/options/options.html",
      },
    ], {
      setConfig,
      deleteTranslationCache,
      executeTabEffect,
    });

    expect(setConfig).toHaveBeenCalledWith("enableDeepL", "no");
    expect(deleteTranslationCache).toHaveBeenCalledWith();
    expect(executeTabEffect).toHaveBeenCalledWith({
      type: "open-tab",
      url: "chrome-extension://id/options/options.html",
    });
  });

  it("creates an install effect executor that routes config, cache, and tab effects", () => {
    const setConfig = vi.fn();
    const deleteTranslationCache = vi.fn();
    const applyTabEffects = vi.fn();

    const executeEffects = createInstallEffectExecutor({
      setConfig,
      deleteTranslationCache,
      applyTabEffects,
    });

    executeEffects([
      {
        type: "set-config",
        key: "enableDeepL",
        value: "no",
      },
      {
        type: "delete-translation-cache",
      },
      {
        type: "open-tab",
        url: "chrome-extension://id/options/options.html",
      },
    ]);

    expect(setConfig).toHaveBeenCalledWith("enableDeepL", "no");
    expect(deleteTranslationCache).toHaveBeenCalledWith();
    expect(applyTabEffects).toHaveBeenCalledWith([
      {
        type: "open-tab",
        url: "chrome-extension://id/options/options.html",
      },
    ]);
  });
});