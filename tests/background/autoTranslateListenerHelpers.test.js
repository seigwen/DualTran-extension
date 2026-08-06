import { describe, expect, it } from "vitest";
import {
  buildDisableAutoTranslateListenerPlan,
  buildEnableAutoTranslateListenerPlan,
} from "../../src/background/autoTranslateListenerHelpers.js";

describe("autoTranslateListenerHelpers", () => {
  it("builds the enable plan with all auto-translate listeners when webNavigation exists", () => {
    expect(buildEnableAutoTranslateListenerPlan(true)).toEqual({
      shouldDisableFirst: true,
      shouldProceed: true,
      addListeners: [
        { target: "tabs.onActivated", method: "addListener", listener: "tabsOnActivated" },
        { target: "tabs.onRemoved", method: "addListener", listener: "tabsOnRemoved" },
        { target: "runtime.onMessage", method: "addListener", listener: "runtimeOnMessage" },
        { target: "webNavigation.onCommitted", method: "addListener", listener: "webNavigationOnCommitted" },
        { target: "webNavigation.onDOMContentLoaded", method: "addListener", listener: "webNavigationOnDOMContentLoaded" },
      ],
    });
  });

  it("builds a no-op enable plan when webNavigation is unavailable", () => {
    expect(buildEnableAutoTranslateListenerPlan(false)).toEqual({
      shouldDisableFirst: true,
      shouldProceed: false,
      addListeners: [],
    });
  });

  it("builds the disable plan with all removable listeners when webNavigation exists", () => {
    expect(buildDisableAutoTranslateListenerPlan(true)).toEqual({
      shouldResetState: true,
      removeListeners: [
        { target: "tabs.onActivated", method: "removeListener", listener: "tabsOnActivated" },
        { target: "tabs.onRemoved", method: "removeListener", listener: "tabsOnRemoved" },
        { target: "runtime.onMessage", method: "removeListener", listener: "runtimeOnMessage" },
        { target: "webNavigation.onCommitted", method: "removeListener", listener: "webNavigationOnCommitted" },
        { target: "webNavigation.onDOMContentLoaded", method: "removeListener", listener: "webNavigationOnDOMContentLoaded" },
      ],
      shouldLogMissingWebNavigation: false,
    });
  });

  it("builds the disable plan without webNavigation listeners when the permission is absent", () => {
    expect(buildDisableAutoTranslateListenerPlan(false)).toEqual({
      shouldResetState: true,
      removeListeners: [
        { target: "tabs.onActivated", method: "removeListener", listener: "tabsOnActivated" },
        { target: "tabs.onRemoved", method: "removeListener", listener: "tabsOnRemoved" },
        { target: "runtime.onMessage", method: "removeListener", listener: "runtimeOnMessage" },
      ],
      shouldLogMissingWebNavigation: true,
    });
  });
});