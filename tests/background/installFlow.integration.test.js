import { describe, expect, it } from "vitest";
import {
  buildInstalledActionPlan,
  buildStartupStorageReset,
  resolveDevelopmentReloadPlan,
} from "../../src/background/installHelpers.js";
import {
  buildDevelopmentReloadExecutionPlan,
  buildInstalledExecutionPlan,
  buildStartupExecutionPlan,
} from "../../src/background/installExecutionHelpers.js";

describe("install flow integration", () => {
  it("combines update planning with execution effects for release notes, cache cleanup, and dev reload", () => {
    const now = 1_700_000_000_000;
    const plan = buildInstalledActionPlan({
      reason: "update",
      currentVersion: "1.2.0",
      previousVersion: "1.1.0",
      isMobile: false,
      showReleaseNotes: "yes",
      lastTimeShowingReleaseNotes: now - 30 * 24 * 60 * 60 * 1000,
      optionsPageUrl: "chrome-extension://id/options/options.html",
      releaseNotesPageUrl: "chrome-extension://id/options/options.html#release_notes",
      now,
    });

    expect(buildInstalledExecutionPlan(plan)).toEqual([
      {
        type: "set-config",
        key: "lastTimeShowingReleaseNotes",
        value: now,
      },
      {
        type: "open-tab",
        url: "chrome-extension://id/options/options.html#release_notes",
      },
      {
        type: "delete-translation-cache",
      },
    ]);

    const reloadTabIds = resolveDevelopmentReloadPlan({
      reason: "update",
      installType: "development",
      tabs: [
        { id: 1, url: "https://example.com" },
        { id: 2, url: "http://example.org/page" },
        { id: 3, url: "chrome://extensions" },
      ],
    });

    expect(buildDevelopmentReloadExecutionPlan(reloadTabIds)).toEqual([
      { type: "reload-tab", tabId: 1 },
      { type: "reload-tab", tabId: 2 },
    ]);
  });

  it("combines install planning with options open and mobile DeepL disable effects", () => {
    const plan = buildInstalledActionPlan({
      reason: "install",
      currentVersion: "1.2.0",
      previousVersion: "1.1.0",
      isMobile: true,
      showReleaseNotes: "yes",
      lastTimeShowingReleaseNotes: 123,
      optionsPageUrl: "chrome-extension://id/options/options.html",
      releaseNotesPageUrl: "chrome-extension://id/options/options.html#release_notes",
    });

    expect(buildInstalledExecutionPlan(plan)).toEqual([
      {
        type: "open-tab",
        url: "chrome-extension://id/options/options.html",
      },
      {
        type: "set-config",
        key: "enableDeepL",
        value: "no",
      },
    ]);
  });

  it("combines startup reset, development install effects, and reload plans into one lifecycle", () => {
    expect(buildStartupExecutionPlan(buildStartupStorageReset())).toEqual([
      {
        type: "set-storage",
        update: {
          tabToMimeType: {},
        },
        logMessage: "tabToMimeType写入成功[object Object]",
      },
      {
        type: "set-storage",
        update: {
          tabHasContentScript: {},
        },
        logMessage: "tabHasContentScript[object Object]",
      },
    ]);

    const installPlan = buildInstalledActionPlan({
      reason: "install",
      currentVersion: "1.2.0",
      previousVersion: "1.1.0",
      isMobile: true,
      showReleaseNotes: "yes",
      lastTimeShowingReleaseNotes: 123,
      optionsPageUrl: "chrome-extension://id/options/options.html",
      releaseNotesPageUrl: "chrome-extension://id/options/options.html#release_notes",
    });

    expect(buildInstalledExecutionPlan(installPlan)).toEqual([
      {
        type: "open-tab",
        url: "chrome-extension://id/options/options.html",
      },
      {
        type: "set-config",
        key: "enableDeepL",
        value: "no",
      },
    ]);

    const reloadTabIds = resolveDevelopmentReloadPlan({
      reason: "install",
      installType: "development",
      tabs: [
        { id: 1, url: "https://example.com" },
        { id: 2, url: "http://example.org/page" },
        { id: 3, url: "chrome://extensions" },
      ],
    });

    expect(buildDevelopmentReloadExecutionPlan(reloadTabIds)).toEqual([
      { type: "reload-tab", tabId: 1 },
      { type: "reload-tab", tabId: 2 },
    ]);
  });

  it("keeps chrome_update lifecycle side effects limited to startup reset without install or reload effects", () => {
    expect(buildStartupExecutionPlan(buildStartupStorageReset())).toHaveLength(2);

    const plan = buildInstalledActionPlan({
      reason: "chrome_update",
      currentVersion: "1.2.0",
      previousVersion: "1.1.0",
      isMobile: false,
      showReleaseNotes: "yes",
      lastTimeShowingReleaseNotes: 123,
      optionsPageUrl: "chrome-extension://id/options/options.html",
      releaseNotesPageUrl: "chrome-extension://id/options/options.html#release_notes",
    });

    expect(buildInstalledExecutionPlan(plan)).toEqual([]);

    const reloadTabIds = resolveDevelopmentReloadPlan({
      reason: "chrome_update",
      installType: "development",
      tabs: [
        { id: 1, url: "https://example.com" },
        { id: 2, url: "http://example.org/page" },
      ],
    });

    expect(buildDevelopmentReloadExecutionPlan(reloadTabIds)).toEqual([]);
  });
});