import { describe, expect, it, vi } from "vitest";
import {
  buildIconEffectPlan,
  resolveActionIconPath,
  resolveSvgIconAppearance,
} from "../../src/background/iconHelpers.js";
import {
  createIconEffectExecutor,
  executeAllTabIconRefresh,
  executeIconEffects,
} from "../../src/background/iconExecutionHelpers.js";

describe("icon dispatch loop integration", () => {
  it("dispatches all-tab icon refreshes through the shared query bridge and icon executor", () => {
    const queryTabs = vi.fn((queryInfo, callback) => {
      callback([
        { id: 3, incognito: false },
        { id: 18, incognito: true },
      ]);
    });
    const resetPageAction = vi.fn();
    const setPageActionIcon = vi.fn();
    const hidePageAction = vi.fn();
    const showPageAction = vi.fn();
    const setActionIcon = vi.fn();

    const executeEffects = createIconEffectExecutor({
      resetPageAction,
      setPageActionIcon,
      hidePageAction,
      showPageAction,
      setActionIcon,
    });

    executeAllTabIconRefresh({
      queryTabs,
      applyIconUpdate(tabId, incognito) {
        executeEffects(
          buildIconEffectPlan({
            tabId,
            hasPageAction: true,
            hasAction: true,
            pageActionIconPath: resolveSvgIconAppearance({
              pageLanguageState: "translated",
              popupBlueWhenSiteIsTranslated: "yes",
              incognito,
            }),
            actionIconPath: resolveActionIconPath({
              pageLanguageState: "translated",
              popupBlueWhenSiteIsTranslated: "yes",
            }),
            showButtonInTheAddressBar: "yes",
          })
        );
      },
    });

    expect(resetPageAction.mock.calls).toEqual([
      [3, false],
      [18, false],
    ]);
    expect(setPageActionIcon.mock.calls).toEqual([
      [{
        tabId: 3,
        path: {
          fillOpacity: "1.0",
          fillColor: "#0061e0",
        },
      }],
      [{
        tabId: 18,
        path: {
          fillOpacity: "1.0",
          fillColor: "#00ddff",
        },
      }],
    ]);
    expect(hidePageAction).not.toHaveBeenCalled();
    expect(showPageAction.mock.calls).toEqual([[3], [18]]);
    expect(setActionIcon.mock.calls).toEqual([
      [{ tabId: 3, path: "/icons/icon-32-translated.png" }],
      [{ tabId: 18, path: "/icons/icon-32-translated.png" }],
    ]);
  });
});