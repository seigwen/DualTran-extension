// Scenario validation for M3 migration: watchdog vs existing floatingBtn semantics
// (Q2/Q5/Q6/Q16). Run via vitest in repo context.
import { describe, expect, it, beforeEach } from "vitest";
import {
  setState,
  getState,
  resetForRebuild,
  __resetForTest,
} from "../../src/contentScript/uiStateStore.js";

describe("watchdog vs floatingBtn semantics (M3 scenarios)", () => {
  beforeEach(() => __resetForTest());

  it("S1: user clicks AI → intervention=true blocks watchdog", () => {
    setState({ intervention: true, highlight: "ai" }, "handleButtonClick");
    setState({ pageLanguageState: "translated" }, "engine");
    // Even though engine derived would be google (aiRenderState idle),
    // intervention=true means user choice is kept
    expect(getState().highlight).toBe("ai");
  });

  it("S2: auto-translate (no intervention) → Google highlight derived", () => {
    setState({ pageLanguageState: "translated" }, "onPageLanguageStateChange");
    expect(getState().highlight).toBe("google");
    expect(getState().displayMode).toBe("google");
  });

  it("S3: restore page → original derived + intervention cleared atomically", () => {
    setState({ intervention: true, highlight: "ai" }, "click");
    setState({ pageLanguageState: "original", intervention: false }, "onPageLanguageStateChange");
    expect(getState().highlight).toBe("original");
    expect(getState().intervention).toBe(false);
  });

  it("S4: AI success + user still on AI → derived ai (matches existing Q2)", () => {
    setState({ intervention: true, highlight: "ai", displayMode: "google" }, "click");
    setState({ aiRenderState: "success", aiModeActive: true }, "onAiRenderStateChange");
    // intervention=true: watchdog skips; existing code sets displayMode=ai via explicit setState
    setState({ displayMode: "ai" }, "onAiRenderStateChange");
    expect(getState().displayMode).toBe("ai");
  });

  it("S5: AI success + user switched away → displayMode stays google (Q5)", () => {
    setState({ intervention: true, highlight: "google", displayMode: "google" }, "click");
    setState({ aiRenderState: "success", aiModeActive: false }, "onAiRenderStateChange");
    expect(getState().displayMode).toBe("google");
    expect(getState().highlight).toBe("google");
  });

  it("S6: AI error + intervention + highlight ai → stays ai (retry semantics)", () => {
    setState({ intervention: true, highlight: "ai" }, "click");
    setState({ aiRenderState: "error" }, "onAiRenderStateChange");
    expect(getState().highlight).toBe("ai");
  });

  it("S7: rebuild after translated+AI → resetForRebuild derives ai", () => {
    setState({ pageLanguageState: "translated", aiRenderState: "success", aiModeActive: true }, "init");
    setState({ intervention: true, highlight: "google", displayMode: "google" }, "user");
    resetForRebuild();
    expect(getState().highlight).toBe("ai");
    expect(getState().intervention).toBe(false);
  });
});
