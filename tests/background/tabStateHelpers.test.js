import { describe, expect, it } from "vitest";
import {
  buildActivatedContextMenuPlan,
  buildContentScriptProbePlan,
  buildInitialContentScriptProbePlans,
  buildMimeTypeStorageUpdate,
  buildTabHasContentScriptProbeWrite,
  buildTabHasContentScriptRemoval,
  buildTabHasContentScriptRemovalWrite,
  buildTabHasContentScriptStorageUpdate,
  resolveActivatedContextMenuResponse,
  resolveTabHasContentScriptProbeUpdate,
  resolveTabUpdatedLifecycleAction,
} from "../../src/background/tabStateHelpers.js";

describe("tabStateHelpers", () => {
  it("builds the tab-activation plan and only refreshes from non-empty language responses", () => {
    expect(buildActivatedContextMenuPlan(18)).toEqual({
      initialPageLanguageState: "original",
      query: {
        tabId: 18,
        message: {
          action: "getCurrentPageLanguageState",
        },
        options: {
          frameId: 0,
        },
      },
    });

    expect(resolveActivatedContextMenuResponse("translated")).toEqual({
      pageLanguageState: "translated",
    });
    expect(resolveActivatedContextMenuResponse("")).toBeNull();
  });

  it("resolves tab update lifecycle actions for loading, complete, and irrelevant states", () => {
    expect(resolveTabUpdatedLifecycleAction({ isTabActive: true, status: "loading" })).toBe("refresh-context-menu");
    expect(resolveTabUpdatedLifecycleAction({ isTabActive: false, status: "loading" })).toBe("noop");
    expect(resolveTabUpdatedLifecycleAction({ isTabActive: false, status: "complete" })).toBe("probe-content-script");
    expect(resolveTabUpdatedLifecycleAction({ isTabActive: true, status: "unloaded" })).toBe("noop");
  });

  it("stores the normalized mime type from response headers", () => {
    expect(
      buildMimeTypeStorageUpdate(
        {
          tabToMimeType: {
            3: "text/html",
          },
        },
        18,
        [
          { name: "cache-control", value: "no-cache" },
          { name: "Content-Type", value: "application/pdf; charset=utf-8" },
        ]
      )
    ).toEqual({
      tabToMimeType: {
        3: "text/html",
        18: "application/pdf",
      },
    });
  });

  it("stores null mimeType when the response has no content-type header", () => {
    expect(buildMimeTypeStorageUpdate({}, 18, [{ name: "etag", value: "abc" }])).toEqual({
      tabToMimeType: {
        18: null,
      },
    });
  });

  it("marks content script presence with a boolean value", () => {
    expect(
      buildTabHasContentScriptStorageUpdate(
        {
          tabHasContentScript: {
            3: true,
          },
        },
        18,
        "yes"
      )
    ).toEqual({
      tabHasContentScript: {
        3: true,
        18: true,
      },
    });

    expect(buildTabHasContentScriptStorageUpdate({}, 18, 0)).toEqual({
      tabHasContentScript: {
        18: false,
      },
    });
  });

  it("resolves content-script probe updates, with optional write-only-on-success behavior", () => {
    expect(
      resolveTabHasContentScriptProbeUpdate({
        storageResult: {
          tabHasContentScript: {
            3: true,
          },
        },
        tabId: 18,
        response: false,
      })
    ).toEqual({
      tabHasContentScript: {
        3: true,
        18: false,
      },
    });

    expect(
      resolveTabHasContentScriptProbeUpdate({
        storageResult: {
          tabHasContentScript: {
            3: true,
          },
        },
        tabId: 18,
        response: false,
        persistOnlyWhenInjected: true,
      })
    ).toBeNull();

    expect(buildContentScriptProbePlan(18)).toEqual({
      tabId: 18,
      message: {
        action: "contentScriptIsInjected",
      },
      options: {
        frameId: 0,
      },
      persistOnlyWhenInjected: false,
    });

    expect(buildInitialContentScriptProbePlans([
      { id: 3 },
      { id: 18 },
      { url: "https://example.com" },
    ])).toEqual([
      {
        tabId: 3,
        message: {
          action: "contentScriptIsInjected",
        },
        options: {
          frameId: 0,
        },
        persistOnlyWhenInjected: true,
      },
      {
        tabId: 18,
        message: {
          action: "contentScriptIsInjected",
        },
        options: {
          frameId: 0,
        },
        persistOnlyWhenInjected: true,
      },
    ]);

    expect(buildTabHasContentScriptProbeWrite({
      storageResult: {
        tabHasContentScript: {
          3: true,
        },
      },
      tabId: 18,
      response: false,
    })).toEqual({
      update: {
        tabHasContentScript: {
          3: true,
          18: false,
        },
      },
    });

    expect(buildTabHasContentScriptProbeWrite({
      storageResult: {
        tabHasContentScript: {
          3: true,
        },
      },
      tabId: 18,
      response: false,
      persistOnlyWhenInjected: true,
    })).toBeNull();
  });

  it("removes closed tabs from the content-script map without mutating other entries", () => {
    expect(
      buildTabHasContentScriptRemoval(
        {
          tabHasContentScript: {
            3: true,
            18: false,
          },
        },
        18
      )
    ).toEqual({
      tabHasContentScript: {
        3: true,
      },
    });
  });

  it("handles removing a missing tab id from an empty content-script map", () => {
    expect(buildTabHasContentScriptRemoval({}, 18)).toEqual({
      tabHasContentScript: {},
    });

    expect(buildTabHasContentScriptRemovalWrite({}, 18)).toEqual({
      update: {
        tabHasContentScript: {},
      },
    });
  });
});