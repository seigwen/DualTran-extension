"use strict";

import { buildMimeTypeStorageUpdate } from "./tabStateHelpers.js";

export function buildMimeTypeHeaderExecutionPlan(update) {
  if (!update) {
    return [];
  }

  return [{
    type: "set-storage",
    update,
    logLabel: "tabToMimeType写入成功:",
    logValue: update.tabToMimeType,
  }];
}

export async function executeMimeTypeHeaderWrite({
  details,
  getStorage,
  applyStorageEffects,
  log,
} = {}) {
  if (!details || details.tabId === -1 || typeof getStorage !== "function") {
    return null;
  }

  const storageResult = await getStorage(["tabToMimeType"]);
  log?.("tabToMimeType读取成功:", storageResult);

  const update = buildMimeTypeStorageUpdate(
    storageResult,
    details.tabId,
    details.responseHeaders
  );
  const effects = buildMimeTypeHeaderExecutionPlan(update);
  await applyStorageEffects?.(effects);

  return update;
}