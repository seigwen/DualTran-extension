"use strict";

export function buildAutoTranslateResetState() {
  return {
    activeTabTranslationInfo: {},
    sitesToAutoTranslate: {},
  };
}

export function resolveAutoTranslateAlarmDispatch(alarmInfo, storageResult) {
  if (alarmInfo?.name !== "alarmAutoTranslate") {
    return null;
  }

  const tabId = storageResult?.tabToAutoTranslate;
  if (tabId === undefined || tabId === null) {
    return null;
  }

  return {
    tabId,
    message: {
      action: "autoTranslateBecauseClickedALink",
    },
    frameId: 0,
  };
}

export function resolveAutoTranslateConfigChange(name, newValue) {
  if (name !== "autoTranslateWhenClickingALink") {
    return null;
  }

  return newValue === "yes" ? "enable" : "disable";
}

export function shouldDisableAutoTranslateForRemovedPermissions(permissions) {
  const permissionList = Array.isArray(permissions?.permissions) ? permissions.permissions : [];
  return permissionList.includes("webNavigation");
}

export function resolveAutoTranslatePermissionBootstrap({
  hasPermissions,
  autoTranslateWhenClickingALink,
}) {
  if (hasPermissions && autoTranslateWhenClickingALink === "yes") {
    return {
      action: "enable",
    };
  }

  return {
    action: "force-disable-config",
    configValue: "no",
  };
}