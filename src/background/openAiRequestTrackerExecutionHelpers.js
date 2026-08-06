"use strict";

import { buildOpenAiRequestTrackingUpdate } from "./openAiRequestTracker.js";

export function buildOpenAiRequestTrackingExecutionPlan(update) {
  if (!update?.requestsToOpenAi) {
    return [];
  }

  return [{
    type: "set-storage",
    update,
    logLabel: "updated requestsToOpenAi:",
    logValue: update.requestsToOpenAi,
  }];
}

export async function executeOpenAiRequestTracking(request, {
  getStorage,
  applyStorageEffects,
  logError,
} = {}) {
  if (request?.action !== "recordNewRequestToOpenAI" || typeof getStorage !== "function") {
    return null;
  }

  let storage = {};
  try {
    storage = await getStorage(["openAiUserType", "requestsToOpenAi"]);
  } catch (error) {
    logError?.(error);
  }

  const update = buildOpenAiRequestTrackingUpdate(storage, request);
  await applyStorageEffects?.(buildOpenAiRequestTrackingExecutionPlan(update));
  return update;
}