/**
 * Tests for uiStateStore — UI state single source of truth (L1) +
 * runtime self-healing (L2).
 *
 * Coverage:
 * - setState validation (unknown field rejected)
 * - watchdog arbitration (engine-driven inconsistency → corrected)
 * - watchdog never overrides user intervention
 * - change log recording + dumpLog
 * - resetForRebuild (SPA rebuild derivation)
 * - subscribe/unsubscribe
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  setState,
  getState,
  subscribe,
  resetForRebuild,
  dumpLog,
  __resetForTest,
} from "../../src/contentScript/uiStateStore.js";

describe("uiStateStore — basic state management", () => {
  beforeEach(() => {
    __resetForTest();
  });

  it("getState returns engine mirrors + UI state defaults", () => {
    expect(getState()).toEqual({
      pageLanguageState: "original",
      pageRenderState: "idle",
      aiRenderState: "idle",
      aiModeActive: true,
      highlight: "original",
      displayMode: "original",
      intervention: false,
      googleInFlight: false,
      aiInFlight: false,
    });
  });

  it("setState applies engine state fields", () => {
    setState({ pageLanguageState: "translated" }, "test");
    expect(getState().pageLanguageState).toBe("translated");
  });

  it("setState applies UI state fields", () => {
    setState({ intervention: true, highlight: "google" }, "test");
    expect(getState().intervention).toBe(true);
    expect(getState().highlight).toBe("google");
  });

  it("setState rejects unknown fields", () => {
    expect(() => setState({ bogusField: 1 }, "test")).toThrow(/unknown state field/);
  });

  it("subscribe fires on change; unsubscribe stops notifications", () => {
    const calls = [];
    const unsub = subscribe((patch) => calls.push(patch));
    setState({ googleInFlight: true }, "test");
    expect(calls).toHaveLength(1);
    expect(calls[0].googleInFlight).toBe(true);
    unsub();
    setState({ googleInFlight: false }, "test");
    expect(calls).toHaveLength(1);
  });
});

describe("uiStateStore — watchdog arbitration (L2)", () => {
  beforeEach(() => {
    __resetForTest();
  });

  it("corrects pageLanguageState=translated without intervention → highlight Google", () => {
    const applied = setState(
      { pageLanguageState: "translated" },
      "onPageLanguageStateChange"
    );
    // Watchdog corrects highlight/displayMode to engine-derived google
    expect(applied.highlight).toBe("google");
    expect(applied.displayMode).toBe("google");
    expect(getState().highlight).toBe("google");
  });

  it("corrects translated + AI success + aiModeActive → highlight AI (reload-restore path)", () => {
    // User's persisted AI choice (sessionStorage flag) → engine re-runs AI
    // after full reload → aiRenderState=success + aiModeActive=true means
    // the page IS showing AI translations. The button must reflect AI.
    // (Bug report: refresh after AI translation → page shows AI but button
    // stays Google highlighted.)
    const applied = setState(
      {
        pageLanguageState: "translated",
        aiRenderState: "success",
        aiModeActive: true,
      },
      "engine"
    );
    expect(applied.highlight).toBe("ai");
    expect(applied.displayMode).toBe("ai");
    expect(getState().highlight).toBe("ai");
    expect(getState().displayMode).toBe("ai");
  });

  it("does NOT correct translated + AI idle (auto-translate path, aiModeActive default true) → Google", () => {
    setState(
      { pageLanguageState: "translated", aiRenderState: "idle" },
      "engine"
    );
    expect(getState().highlight).toBe("google");
    expect(getState().displayMode).toBe("google");
  });

  it("never overrides user intervention (highlight=ai with engine original)", () => {
    setState({ intervention: true, highlight: "ai" }, "handleButtonClick");
    // Engine unchanged (original) but user picked AI — watchdog must NOT correct
    setState({ pageRenderState: "idle" }, "engine");
    expect(getState().highlight).toBe("ai");
  });

  it("does NOT auto-clear in-flight flags — they are request-lifecycle markers managed by event callbacks", () => {
    // Design decision: googleInFlight/aiInFlight mean "request dispatched",
    // which can precede the engine's aiRenderState=loading window (e.g.
    // translatePageAi() sets aiInFlight=true before the streaming state
    // arrives). Deriving them from engine state would race. Watchdog only
    // arbitrates highlight/displayMode; event callbacks must explicitly
    // setState({googleInFlight:false}) on render idle (as floatingBtn does).
    setState({ googleInFlight: true }, "translatePage");
    setState({ pageRenderState: "idle" }, "engine");
    expect(getState().googleInFlight).toBe(true);
  });
});

describe("uiStateStore — change log (L2 diagnostics)", () => {
  beforeEach(() => {
    __resetForTest();
  });

  it("records source, patch and before/after snapshots", () => {
    setState({ pageLanguageState: "translated" }, "onPageLanguageStateChange");
    const log = dumpLog();
    expect(log).toHaveLength(1);
    expect(log[0].source).toBe("onPageLanguageStateChange");
    expect(log[0].patch.pageLanguageState).toBe("translated");
    expect(log[0].before.pageLanguageState).toBe("original");
    expect(log[0].after.pageLanguageState).toBe("translated");
  });

  it("ring buffer caps at 50 entries", () => {
    for (let i = 0; i < 60; i++) {
      setState({ pageRenderState: i % 2 === 0 ? "loading" : "idle" }, `evt${i}`);
    }
    expect(dumpLog()).toHaveLength(50);
  });
});

describe("uiStateStore — resetForRebuild (SPA navigation)", () => {
  beforeEach(() => {
    __resetForTest();
  });

  it("derives UI state from engine on rebuild (translated + AI success → AI)", () => {
    setState(
      {
        pageLanguageState: "translated",
        aiRenderState: "success",
        aiModeActive: true,
      },
      "engine"
    );
    setState({ intervention: true, highlight: "google" }, "user");
    resetForRebuild();
    expect(getState().intervention).toBe(false);
    expect(getState().highlight).toBe("ai");
    expect(getState().displayMode).toBe("ai");
  });

  it("derives Original on rebuild when engine is original", () => {
    resetForRebuild();
    expect(getState().highlight).toBe("original");
    expect(getState().displayMode).toBe("original");
  });
});
