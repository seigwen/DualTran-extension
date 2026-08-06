import { describe, expect, it } from "vitest";
import {
  buildContentScriptProbePlan,
  buildInitialContentScriptProbePlans,
  buildTabHasContentScriptProbeWrite,
  buildTabHasContentScriptRemovalWrite,
  resolveTabUpdatedLifecycleAction,
} from "../../src/background/tabStateHelpers.js";
import { buildTabHasContentScriptExecutionPlan } from "../../src/background/tabStateExecutionHelpers.js";

describe("tab state flow integration", () => {
  it("combines complete-state probing with storage-write execution", () => {
    expect(resolveTabUpdatedLifecycleAction({
      isTabActive: false,
      status: "complete",
    })).toBe("probe-content-script");

    const probePlan = buildContentScriptProbePlan(18);
    expect(probePlan).toEqual({
      tabId: 18,
      message: { action: "contentScriptIsInjected" },
      options: { frameId: 0 },
      persistOnlyWhenInjected: false,
    });

    const writePlan = buildTabHasContentScriptProbeWrite({
      storageResult: { tabHasContentScript: { 3: true } },
      tabId: probePlan.tabId,
      response: true,
      persistOnlyWhenInjected: probePlan.persistOnlyWhenInjected,
    });

    expect(buildTabHasContentScriptExecutionPlan(writePlan)).toEqual([
      {
        type: "set-storage",
        update: {
          tabHasContentScript: {
            3: true,
            18: true,
          },
        },
        logLabel: "tabHasContentScript write succeeded:",
        logValue: {
          3: true,
          18: true,
        },
      },
    ]);
  });

  it("combines startup probing and tab removal cleanup into execution effects", () => {
    const startupProbePlans = buildInitialContentScriptProbePlans([
      { id: 3 },
      { id: 18 },
      { url: "https://example.com" },
    ]);

    expect(startupProbePlans.map((plan) => plan.tabId)).toEqual([3, 18]);

    expect(buildTabHasContentScriptExecutionPlan(
      buildTabHasContentScriptRemovalWrite({
        tabHasContentScript: {
          3: true,
          18: false,
        },
      }, 18)
    )).toEqual([
      {
        type: "set-storage",
        update: {
          tabHasContentScript: {
            3: true,
          },
        },
        logLabel: "tabHasContentScript write succeeded:",
        logValue: {
          3: true,
        },
      },
    ]);
  });
});