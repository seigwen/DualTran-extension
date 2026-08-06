"use strict";

import {
  buildActiveTabTranslationBootstrap,
  resolveActiveTabTranslationQueryResponse,
} from "./autoTranslateLinkHelpers.js";
import { queryMainFrame } from "./runtimeMessageHelpers.js";

export async function executeActiveTabTranslationBootstrap(tab, {
  setActiveTabTranslationInfo,
  sendTabMessage,
  afterSend,
} = {}) {
  const bootstrap = buildActiveTabTranslationBootstrap(tab);
  if (!bootstrap || !sendTabMessage) {
    return null;
  }

  setActiveTabTranslationInfo?.(bootstrap.initialActiveTabTranslationInfo);

  const pageLanguageState = await queryMainFrame(
    bootstrap.query.tabId,
    bootstrap.query.message.action,
    sendTabMessage,
    afterSend
  );

  const responseUpdate = resolveActiveTabTranslationQueryResponse(tab, pageLanguageState);
  if (responseUpdate) {
    setActiveTabTranslationInfo?.(responseUpdate);
  }

  return responseUpdate;
}

export function executeQueriedActiveTabTranslationBootstrap({
  queryTabs,
  setActiveTabTranslationInfo,
  sendTabMessage,
  afterSend,
} = {}) {
  if (typeof queryTabs !== "function") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    queryTabs(
      {
        active: true,
        currentWindow: true,
      },
      async (tabs) => {
        if (!tabs?.[0]) {
          resolve(null);
          return;
        }

        const responseUpdate = await executeActiveTabTranslationBootstrap(tabs[0], {
          setActiveTabTranslationInfo,
          sendTabMessage,
          afterSend,
        });
        resolve(responseUpdate);
      }
    );
  });
}

export async function executeAutoTranslateDomEffects(effects, {
  setStorage,
  createAlarm,
} = {}) {
  for (const effect of effects || []) {
    if (effect?.type === "set-storage") {
      await setStorage?.(effect.update);
    } else if (effect?.type === "create-alarm") {
      createAlarm?.(effect.name, effect.alarmInfo);
    }
  }
}