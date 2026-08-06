"use strict";

import { buildMimeTypeStorageUpdate } from "./tabStateHelpers.js";

export function buildMimeTypeHeaderExecutionPlan(update) {
  if (!update) {
    return [];
  }

  return [{
    type: "set-storage",
    update,
    logLabel: "tabToMimeType write succeeded:",
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
  log?.("tabToMimeType read succeeded:", storageResult);

  const update = buildMimeTypeStorageUpdate(
    storageResult,
    details.tabId,
    details.responseHeaders
  );
  const effects = buildMimeTypeHeaderExecutionPlan(update);
  await applyStorageEffects?.(effects);

  return update;
}