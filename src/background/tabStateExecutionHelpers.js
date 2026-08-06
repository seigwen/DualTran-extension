"use strict";

import {
  buildContentScriptProbePlan,
  buildInitialContentScriptProbePlans,
  buildTabHasContentScriptProbeWrite,
  buildTabHasContentScriptRemovalWrite,
} from "./tabStateHelpers.js";

export function buildTabHasContentScriptExecutionPlan(writePlan) {
  if (!writePlan?.update) {
    return [];
  }

  return [{
    type: "set-storage",
    update: writePlan.update,
    logLabel: "tabHasContentScript write succeeded:",
    logValue: writePlan.update.tabHasContentScript,
  }];
}

async function executeTabHasContentScriptProbePlan(probePlan, {
  sendTabMessage,
  getStorage,
  afterSend,
  applyStorageEffects,
} = {}) {
  if (!probePlan || typeof sendTabMessage !== "function" || typeof getStorage !== "function") {
    return null;
  }

  return await new Promise((resolve) => {
    sendTabMessage(
      probePlan.tabId,
      probePlan.message,
      probePlan.options,
      async (response) => {
        afterSend?.();

        const storageResult = await getStorage(["tabHasContentScript"]);
        const writePlan = buildTabHasContentScriptProbeWrite({
          storageResult,
          tabId: probePlan.tabId,
          response,
          persistOnlyWhenInjected: probePlan.persistOnlyWhenInjected,
        });

        applyStorageEffects?.(buildTabHasContentScriptExecutionPlan(writePlan));
        resolve(writePlan);
      }
    );
  });
}

export async function executeContentScriptProbe(tabId, {
  persistOnlyWhenInjected = false,
  sendTabMessage,
  getStorage,
  afterSend,
  applyStorageEffects,
} = {}) {
  if (tabId === undefined || tabId === null) {
    return null;
  }

  return await executeTabHasContentScriptProbePlan(
    buildContentScriptProbePlan(tabId, persistOnlyWhenInjected),
    {
      sendTabMessage,
      getStorage,
      afterSend,
      applyStorageEffects,
    }
  );
}

export async function executeInitialContentScriptProbeBroadcast({
  queryTabs,
  sendTabMessage,
  getStorage,
  afterSend,
  applyStorageEffects,
} = {}) {
  if (typeof queryTabs !== "function" || typeof sendTabMessage !== "function" || typeof getStorage !== "function") {
    return [];
  }

  return await new Promise((resolve) => {
    queryTabs({}, async (tabs) => {
      const results = await Promise.all(
        buildInitialContentScriptProbePlans(tabs).map((probePlan) =>
          executeTabHasContentScriptProbePlan(probePlan, {
            sendTabMessage,
            getStorage,
            afterSend,
            applyStorageEffects,
          })
        )
      );

      resolve(results);
    });
  });
}

export async function executeTabHasContentScriptRemoval(tabId, {
  getStorage,
  applyStorageEffects,
} = {}) {
  if (tabId === undefined || tabId === null || typeof getStorage !== "function") {
    return null;
  }

  const storageResult = await getStorage(["tabHasContentScript"]);
  const writePlan = buildTabHasContentScriptRemovalWrite(storageResult, tabId);
  applyStorageEffects?.(buildTabHasContentScriptExecutionPlan(writePlan));
  return writePlan;
}