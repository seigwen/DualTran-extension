"use strict";

export function queryMainFrame(tabId, action, sendTabMessage, afterSend = undefined) {
  return new Promise((resolve) => {
    sendTabMessage(
      tabId,
      { action },
      { frameId: 0 },
      (result) => {
        afterSend?.();
        resolve(result);
      }
    );
  });
}

export function getTabHostNameFromSender(sender) {
  return new URL(sender.tab.url).hostname;
}

export function detectTabLanguageForSender(sender, detectLanguage) {
  return new Promise((resolve) => {
    if (!sender?.tab) {
      resolve("und");
      return;
    }

    try {
      detectLanguage(sender.tab.id, (result) => {
        resolve(result);
      });
    } catch (_) {
      resolve("und");
    }
  });
}

export async function getActiveTabMimeType(queryTabs, storageGet) {
  const tabs = await new Promise((resolve) => {
    queryTabs({ active: true, currentWindow: true }, (result) => {
      resolve(result || []);
    });
  });

  const storage = await storageGet(["tabToMimeType"]);
  return storage?.tabToMimeType?.[tabs[0]?.id];
}