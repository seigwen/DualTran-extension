"use strict";

const RELEASE_NOTES_INTERVAL_MS = 21 * 24 * 60 * 60 * 1000;

export function buildStartupStorageReset() {
  return {
    tabToMimeType: {},
    tabHasContentScript: {},
  };
}

export function evaluateReleaseNotesDisplay(lastTimeShowingReleaseNotes, now = Date.now()) {
  if (!lastTimeShowingReleaseNotes) {
    return {
      shouldShow: true,
      nextLastTimeShowingReleaseNotes: now,
    };
  }

  if (now - lastTimeShowingReleaseNotes > RELEASE_NOTES_INTERVAL_MS) {
    return {
      shouldShow: true,
      nextLastTimeShowingReleaseNotes: now,
    };
  }

  return {
    shouldShow: false,
    nextLastTimeShowingReleaseNotes: lastTimeShowingReleaseNotes,
  };
}

export function getReloadableTabIds(tabs) {
  return (tabs || [])
    .filter((tab) => /^https?:\/\//i.test(tab?.url || ""))
    .map((tab) => tab.id)
    .filter((tabId) => tabId !== undefined && tabId !== null);
}

export function buildInstalledActionPlan({
  reason,
  currentVersion,
  previousVersion,
  isMobile,
  showReleaseNotes,
  lastTimeShowingReleaseNotes,
  optionsPageUrl,
  releaseNotesPageUrl,
  now = Date.now(),
}) {
  const plan = {
    openPageUrl: null,
    shouldSetLastTimeShowingReleaseNotes: false,
    nextLastTimeShowingReleaseNotes: lastTimeShowingReleaseNotes,
    shouldDeleteTranslationCache: false,
    shouldDisableDeepL: !!isMobile,
    shouldAttemptDevelopmentReload: reason === "install" || reason === "update",
  };

  if (reason === "install") {
    plan.openPageUrl = optionsPageUrl;
    return plan;
  }

  if (reason !== "update" || currentVersion === previousVersion) {
    return plan;
  }

  if (isMobile || showReleaseNotes !== "yes") {
    return plan;
  }

  const releaseNotesDecision = evaluateReleaseNotesDisplay(lastTimeShowingReleaseNotes, now);
  plan.shouldSetLastTimeShowingReleaseNotes = releaseNotesDecision.shouldShow;
  plan.nextLastTimeShowingReleaseNotes = releaseNotesDecision.nextLastTimeShowingReleaseNotes;
  plan.openPageUrl = releaseNotesDecision.shouldShow ? releaseNotesPageUrl : null;
  plan.shouldDeleteTranslationCache = true;

  return plan;
}

export function resolveDevelopmentReloadPlan({
  reason,
  installType,
  tabs,
}) {
  if ((reason !== "install" && reason !== "update") || installType !== "development") {
    return [];
  }

  return getReloadableTabIds(tabs);
}