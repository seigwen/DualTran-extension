import { describe, expect, it, vi } from "vitest";
import {
  buildAutoTranslateDomExecutionPlan,
  buildSitesToAutoTranslateOnCommitted,
  resolveAutoTranslateOnDOMContentLoaded,
} from "../../src/background/autoTranslateLinkHelpers.js";
import { executeAutoTranslateDomEffects } from "../../src/background/autoTranslateLinkExecutionHelpers.js";

describe("auto-translate dom dispatch loop integration", () => {
  it("dispatches remembered same-host DOMContentLoaded scheduling through storage and alarm handlers", async () => {
    const setStorage = vi.fn(async () => undefined);
    const createAlarm = vi.fn();

    const rememberedSites = buildSitesToAutoTranslateOnCommitted(
      {},
      {
        tabId: 18,
        pageLanguageState: "translated",
        url: "https://example.com/start",
      },
      {
        tabId: 18,
        frameId: 0,
        transitionType: "link",
        url: "https://example.com/next",
      }
    );

    await executeAutoTranslateDomEffects(
      buildAutoTranslateDomExecutionPlan(
        resolveAutoTranslateOnDOMContentLoaded(rememberedSites, {
          tabId: 18,
          frameId: 0,
          url: "https://example.com/next",
        })
      ),
      {
        setStorage,
        createAlarm,
      }
    );

    expect(setStorage).toHaveBeenCalledWith({
      tabToAutoTranslate: 18,
    });
    expect(createAlarm).toHaveBeenCalledWith("alarmAutoTranslate", {
      delayInMinutes: 0.01,
    });
  });

  it("skips dispatch when DOMContentLoaded does not match a remembered top-level site", async () => {
    const setStorage = vi.fn(async () => undefined);
    const createAlarm = vi.fn();

    await executeAutoTranslateDomEffects(
      buildAutoTranslateDomExecutionPlan(
        resolveAutoTranslateOnDOMContentLoaded(
          {
            18: "example.com",
          },
          {
            tabId: 18,
            frameId: 2,
            url: "https://example.com/next",
          }
        )
      ),
      {
        setStorage,
        createAlarm,
      }
    );

    expect(setStorage).not.toHaveBeenCalled();
    expect(createAlarm).not.toHaveBeenCalled();
  });
});