/**
 * Tests for resolveSingletonBtnClick — the pure decision function for
 * block-level singleton hover button clicks (#65, three-button direct-select).
 *
 * Seam: pure function, zero mocks. Maps (blockState, buttonId, ctx) →
 * action descriptor. The executor lives in pageTranslator.js
 * (handleSingletonBtnClick); this table is the single decision point.
 *
 * Semantics (doc 19 §NQ1 / NQ4): direct-select — click = "show that mode".
 * Clicking the already-displayed mode is a noop; in-flight is a noop
 * (never re-send a running/completed request); restore responsibility
 * lives on the Original button only.
 */

import { describe, expect, it } from "vitest";
import { resolveSingletonBtnClick } from "../../src/contentScript/singletonBtnClickResolver.js";

function baseState(overrides = {}) {
  return {
    displayMode: "google", // "original" | "google" | "ai"
    googleBtnState: "idle", // "idle" | "translating" | "success"
    aiStatus: "idle", // "idle" | "queuing" | "translating" | "translated" | "translationError" | "userPinned"
    translationId: "",
    ...overrides,
  };
}

const ctx = (overrides = {}) => ({ hasApiKey: true, hasStoredGoogleText: false, ...overrides });

describe("resolveSingletonBtnClick — Original button (restore lives here)", () => {
  it("displayMode=original, nothing in flight → noop", () => {
    expect(resolveSingletonBtnClick(baseState({ displayMode: "original" }), "original", ctx())).toEqual({ type: "noop" });
  });

  it("displayMode=google → restoreBlock", () => {
    expect(resolveSingletonBtnClick(baseState({ displayMode: "google" }), "original", ctx())).toEqual({ type: "restoreBlock" });
  });

  it("displayMode=ai → restoreBlock", () => {
    expect(resolveSingletonBtnClick(baseState({ displayMode: "ai", aiStatus: "translated" }), "original", ctx())).toEqual({ type: "restoreBlock" });
  });

  it("Google request in flight → restoreBlock (immediate restore, cancels in-flight)", () => {
    expect(
      resolveSingletonBtnClick(baseState({ displayMode: "original", googleBtnState: "translating" }), "original", ctx())
    ).toEqual({ type: "restoreBlock" });
  });

  it("AI request in flight → restoreBlock (immediate restore, cancels in-flight)", () => {
    expect(
      resolveSingletonBtnClick(baseState({ displayMode: "ai", aiStatus: "translating" }), "original", ctx())
    ).toEqual({ type: "restoreBlock" });
  });
});

describe("resolveSingletonBtnClick — Google button (direct select)", () => {
  it("displayMode=google → noop (clicking the current mode)", () => {
    expect(resolveSingletonBtnClick(baseState({ displayMode: "google" }), "google", ctx())).toEqual({ type: "noop" });
  });

  it("Google request in flight → noop (never re-send)", () => {
    expect(
      resolveSingletonBtnClick(baseState({ displayMode: "original", googleBtnState: "translating" }), "google", ctx())
    ).toEqual({ type: "noop" });
  });

  it("displayMode=ai → showGoogle (local switch, no network)", () => {
    expect(
      resolveSingletonBtnClick(baseState({ displayMode: "ai", aiStatus: "translated" }), "google", ctx())
    ).toEqual({ type: "showGoogle" });
  });

  it("displayMode=original + stored Google text → showGoogle (local replay, no network)", () => {
    expect(
      resolveSingletonBtnClick(baseState({ displayMode: "original" }), "google", ctx({ hasStoredGoogleText: true }))
    ).toEqual({ type: "showGoogle" });
  });

  it("displayMode=original + no stored text → fetchGoogle (network)", () => {
    expect(
      resolveSingletonBtnClick(baseState({ displayMode: "original" }), "google", ctx({ hasStoredGoogleText: false }))
    ).toEqual({ type: "fetchGoogle" });
  });
});

describe("resolveSingletonBtnClick — AI button (direct select)", () => {
  it("displayMode=ai → noop (clicking the current mode)", () => {
    expect(resolveSingletonBtnClick(baseState({ displayMode: "ai", aiStatus: "translated" }), "ai", ctx())).toEqual({ type: "noop" });
  });

  it("AI request in flight → noop (never re-send)", () => {
    expect(resolveSingletonBtnClick(baseState({ aiStatus: "translating" }), "ai", ctx())).toEqual({ type: "noop" });
  });

  it("no API key → promptConfig (takes precedence over retry)", () => {
    expect(
      resolveSingletonBtnClick(baseState({ aiStatus: "translationError" }), "ai", ctx({ hasApiKey: false }))
    ).toEqual({ type: "promptConfig" });
  });

  it("aiStatus=translationError → retryAi", () => {
    expect(resolveSingletonBtnClick(baseState({ aiStatus: "translationError" }), "ai", ctx())).toEqual({ type: "retryAi" });
  });

  it("aiStatus=translated (showing Google) → showAi (local re-show, no network)", () => {
    expect(resolveSingletonBtnClick(baseState({ displayMode: "google", aiStatus: "translated" }), "ai", ctx())).toEqual({ type: "showAi" });
  });

  it("displayMode=google + AI not yet run → fetchAi (AI on top of Google)", () => {
    expect(resolveSingletonBtnClick(baseState({ displayMode: "google", aiStatus: "idle" }), "ai", ctx())).toEqual({ type: "fetchAi" });
  });

  it("displayMode=original → fetchAi (Google+AI concurrent path)", () => {
    expect(resolveSingletonBtnClick(baseState({ displayMode: "original", aiStatus: "userPinned" }), "ai", ctx())).toEqual({ type: "fetchAi" });
  });
});

describe("resolveSingletonBtnClick — defenses & legacy fallback", () => {
  it("null/undefined blockState → noop", () => {
    expect(resolveSingletonBtnClick(null, "google", ctx())).toEqual({ type: "noop" });
    expect(resolveSingletonBtnClick(undefined, "ai", ctx())).toEqual({ type: "noop" });
  });

  it("unknown buttonId → noop", () => {
    expect(resolveSingletonBtnClick(baseState(), "close", ctx())).toEqual({ type: "noop" });
  });

  it("legacy state without displayMode (aiStatus=translated) derives 'ai'", () => {
    const legacy = { googleBtnState: "success", aiStatus: "translated", translationId: "" };
    // Derived displayMode="ai" → Google click = showGoogle (local switch)
    expect(resolveSingletonBtnClick(legacy, "google", ctx())).toEqual({ type: "showGoogle" });
    // Derived displayMode="ai" → AI click = noop (already showing)
    expect(resolveSingletonBtnClick(legacy, "ai", ctx())).toEqual({ type: "noop" });
  });

  it("legacy state without displayMode (aiStatus=idle) derives 'google'", () => {
    const legacy = { googleBtnState: "success", aiStatus: "idle", translationId: "" };
    // Derived displayMode="google" → Google click = noop (already showing)
    expect(resolveSingletonBtnClick(legacy, "google", ctx())).toEqual({ type: "noop" });
    // Derived displayMode="google" → AI click = fetchAi
    expect(resolveSingletonBtnClick(legacy, "ai", ctx())).toEqual({ type: "fetchAi" });
  });
});
