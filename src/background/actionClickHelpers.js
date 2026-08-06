"use strict";

export function resolveDesktopToggleTranslationMessage(translateClickingOnce) {
  if (translateClickingOnce !== "yes") {
    return null;
  }

  return {
    action: "toggle-translation",
  };
}

export function resolveMobileActionClickMessage() {
  return {
    action: "showPopupMobile",
  };
}

export function resolveMobilePageActionUpdate(status) {
  return status === "loading" ? "hide" : "noop";
}

export function collectTabIds(tabs = []) {
  return tabs.map((tab) => tab.id);
}