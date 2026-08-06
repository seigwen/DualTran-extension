"use strict";

export function resolveActionConfigChange(name) {
  if (name === "useOldPopup") {
    return {
      resetBrowserAction: true,
      resetActivePageAction: false,
    };
  }

  if (name === "translateClickingOnce") {
    return {
      resetBrowserAction: true,
      resetActivePageAction: true,
    };
  }

  return {
    resetBrowserAction: false,
    resetActivePageAction: false,
  };
}

export function shouldRefreshIconsForConfigChange(name) {
  return ["useOldPopup", "showButtonInTheAddressBar"].includes(name);
}