import { describe, expect, it } from "vitest";
import {
  buildInstalledActionPlan,
  buildStartupStorageReset,
  evaluateReleaseNotesDisplay,
  getReloadableTabIds,
  resolveDevelopmentReloadPlan,
} from "../../src/background/installHelpers.js";

describe("installHelpers", () => {
  it("builds the startup storage reset payload for tab maps", () => {
    expect(buildStartupStorageReset()).toEqual({
      tabToMimeType: {},
      tabHasContentScript: {},
    });
  });

  it("shows release notes and stores now when it has never shown them before", () => {
    const now = 1_700_000_000_000;

    expect(evaluateReleaseNotesDisplay(undefined, now)).toEqual({
      shouldShow: true,
      nextLastTimeShowingReleaseNotes: now,
    });
  });

  it("does not show release notes again inside the 21-day window", () => {
    const now = 1_700_000_000_000;
    const lastShown = now - 10 * 24 * 60 * 60 * 1000;

    expect(evaluateReleaseNotesDisplay(lastShown, now)).toEqual({
      shouldShow: false,
      nextLastTimeShowingReleaseNotes: lastShown,
    });
  });

  it("shows release notes again after the 21-day window has passed", () => {
    const now = 1_700_000_000_000;
    const lastShown = now - 30 * 24 * 60 * 60 * 1000;

    expect(evaluateReleaseNotesDisplay(lastShown, now)).toEqual({
      shouldShow: true,
      nextLastTimeShowingReleaseNotes: now,
    });
  });

  it("returns only reloadable http and https tab ids", () => {
    expect(
      getReloadableTabIds([
        { id: 1, url: "https://example.com" },
        { id: 2, url: "http://example.org/page" },
        { id: 3, url: "chrome://extensions" },
        { id: 4, url: "file:///c:/doc.txt" },
        { id: 5, url: "chrome-extension://abc/popup.html" },
        { id: 6, url: "" },
        { id: null, url: "https://missing-id.example" },
      ])
    ).toEqual([1, 2]);
  });

  it("builds an install plan that opens the options page and disables DeepL on mobile", () => {
    expect(buildInstalledActionPlan({
      reason: "install",
      currentVersion: "1.2.0",
      previousVersion: "1.1.0",
      isMobile: true,
      showReleaseNotes: "yes",
      lastTimeShowingReleaseNotes: 123,
      optionsPageUrl: "chrome-extension://id/options/options.html",
      releaseNotesPageUrl: "chrome-extension://id/options/options.html#release_notes",
    })).toEqual({
      openPageUrl: "chrome-extension://id/options/options.html",
      shouldSetLastTimeShowingReleaseNotes: false,
      nextLastTimeShowingReleaseNotes: 123,
      shouldDeleteTranslationCache: false,
      shouldDisableDeepL: true,
      shouldAttemptDevelopmentReload: true,
    });
  });

  it("builds an update plan that opens release notes and clears cache after the cooldown", () => {
    const now = 1_700_000_000_000;

    expect(buildInstalledActionPlan({
      reason: "update",
      currentVersion: "1.2.0",
      previousVersion: "1.1.0",
      isMobile: false,
      showReleaseNotes: "yes",
      lastTimeShowingReleaseNotes: now - 30 * 24 * 60 * 60 * 1000,
      optionsPageUrl: "chrome-extension://id/options/options.html",
      releaseNotesPageUrl: "chrome-extension://id/options/options.html#release_notes",
      now,
    })).toEqual({
      openPageUrl: "chrome-extension://id/options/options.html#release_notes",
      shouldSetLastTimeShowingReleaseNotes: true,
      nextLastTimeShowingReleaseNotes: now,
      shouldDeleteTranslationCache: true,
      shouldDisableDeepL: false,
      shouldAttemptDevelopmentReload: true,
    });
  });

  it("skips update release-note side effects when the version did not change or notes are disabled", () => {
    expect(buildInstalledActionPlan({
      reason: "update",
      currentVersion: "1.2.0",
      previousVersion: "1.2.0",
      isMobile: false,
      showReleaseNotes: "yes",
      lastTimeShowingReleaseNotes: 123,
      optionsPageUrl: "options",
      releaseNotesPageUrl: "release-notes",
    })).toEqual({
      openPageUrl: null,
      shouldSetLastTimeShowingReleaseNotes: false,
      nextLastTimeShowingReleaseNotes: 123,
      shouldDeleteTranslationCache: false,
      shouldDisableDeepL: false,
      shouldAttemptDevelopmentReload: true,
    });

    expect(buildInstalledActionPlan({
      reason: "update",
      currentVersion: "1.2.0",
      previousVersion: "1.1.0",
      isMobile: false,
      showReleaseNotes: "no",
      lastTimeShowingReleaseNotes: 456,
      optionsPageUrl: "options",
      releaseNotesPageUrl: "release-notes",
    })).toEqual({
      openPageUrl: null,
      shouldSetLastTimeShowingReleaseNotes: false,
      nextLastTimeShowingReleaseNotes: 456,
      shouldDeleteTranslationCache: false,
      shouldDisableDeepL: false,
      shouldAttemptDevelopmentReload: true,
    });
  });

  it("returns reloadable tab ids only for development installs and updates", () => {
    const tabs = [
      { id: 1, url: "https://example.com" },
      { id: 2, url: "http://example.org/page" },
      { id: 3, url: "chrome://extensions" },
    ];

    expect(resolveDevelopmentReloadPlan({
      reason: "install",
      installType: "development",
      tabs,
    })).toEqual([1, 2]);

    expect(resolveDevelopmentReloadPlan({
      reason: "update",
      installType: "normal",
      tabs,
    })).toEqual([]);

    expect(resolveDevelopmentReloadPlan({
      reason: "chrome_update",
      installType: "development",
      tabs,
    })).toEqual([]);
  });
});