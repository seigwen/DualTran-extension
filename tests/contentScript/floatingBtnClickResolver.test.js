/**
 * Tests for resolveFloatingBtnClick — the pure decision function for
 * floating button clicks (three-state model: Original / Google / AI).
 *
 * Seam: pure function, zero mocks. Maps (uiState, buttonId) → action descriptor.
 * Behavior table: /root/DualTran-manage/05-floating-btn-three-state-plan.md (Q28, 20 scenarios)
 */

import { describe, expect, it } from "vitest";
import {
  resolveFloatingBtnClick,
  resolveInitialUiState,
} from "../../src/contentScript/floatingBtnClickResolver.js";

function baseState(overrides = {}) {
  return {
    pageLanguageState: "original", // "original" | "translated"
    displayMode: "original", // what the page currently shows: "original" | "google" | "ai"
    highlight: "original", // currently highlighted button
    intervention: false, // user has clicked a button on this page
    googleInFlight: false,
    aiInFlight: false,
    hasGoogleFailedBlocks: false,
    hasAiFailedBlocks: false,
    aiResultAvailable: false, // newLine mode: AI text exists and can be re-shown locally
    hasApiKey: true,
    whereToDisplayTranslatedText: "newLine",
    ...overrides,
  };
}

describe("resolveFloatingBtnClick — Original button", () => {
  it("page original + Original highlighted → noop", () => {
    expect(resolveFloatingBtnClick(baseState(), "original")).toEqual({ type: "noop" });
  });

  it("page original + Google highlighted (e.g. after Google failure) → noop (page already shows original)", () => {
    expect(
      resolveFloatingBtnClick(baseState({ highlight: "google" }), "original")
    ).toEqual({ type: "noop" });
  });

  it("Google translation displayed → restorePage", () => {
    expect(
      resolveFloatingBtnClick(
        baseState({ pageLanguageState: "translated", displayMode: "google", highlight: "google" }),
        "original"
      )
    ).toEqual({ type: "restorePage" });
  });

  it("AI translation displayed → restorePage", () => {
    expect(
      resolveFloatingBtnClick(
        baseState({ pageLanguageState: "translated", displayMode: "ai", highlight: "ai" }),
        "original"
      )
    ).toEqual({ type: "restorePage" });
  });

  it("Google request in-flight (page still original) → restorePage (cancels the in-flight request)", () => {
    expect(
      resolveFloatingBtnClick(baseState({ googleInFlight: true }), "original")
    ).toEqual({ type: "restorePage" });
  });

  it("AI request in-flight (page still original) → restorePage (cancels the in-flight request)", () => {
    expect(
      resolveFloatingBtnClick(baseState({ aiInFlight: true }), "original")
    ).toEqual({ type: "restorePage" });
  });
});

describe("resolveFloatingBtnClick — Google button", () => {
  it("page original → translatePage", () => {
    expect(resolveFloatingBtnClick(baseState(), "google")).toEqual({ type: "translatePage" });
  });

  it("page original + Google highlighted (e.g. after failure) → translatePage (retry)", () => {
    expect(
      resolveFloatingBtnClick(baseState({ highlight: "google" }), "google")
    ).toEqual({ type: "translatePage" });
  });

  it("Google translation displayed + Google highlighted → noop (Q16-revised)", () => {
    expect(
      resolveFloatingBtnClick(
        baseState({ pageLanguageState: "translated", displayMode: "google", highlight: "google" }),
        "google"
      )
    ).toEqual({ type: "noop" });
  });

  it("Google request in-flight → noop (Q16-revised)", () => {
    expect(
      resolveFloatingBtnClick(baseState({ googleInFlight: true }), "google")
    ).toEqual({ type: "noop" });
  });

  it("AI translation displayed → showGoogleOnly (local switch, no requests — Q9)", () => {
    expect(
      resolveFloatingBtnClick(
        baseState({ pageLanguageState: "translated", displayMode: "ai", highlight: "ai" }),
        "google"
      )
    ).toEqual({ type: "showGoogleOnly" });
  });

  it("page translated but displayMode original (edge) → showGoogleOnly", () => {
    expect(
      resolveFloatingBtnClick(
        baseState({ pageLanguageState: "translated", displayMode: "original" }),
        "google"
      )
    ).toEqual({ type: "showGoogleOnly" });
  });
});

describe("resolveFloatingBtnClick — AI button", () => {
  it("page original + has key → translatePageAi (Google+AI parallel)", () => {
    expect(resolveFloatingBtnClick(baseState(), "ai")).toEqual({ type: "translatePageAi" });
  });

  it("page original + AI already highlighted (e.g. after no-key click) → translatePageAi (Q16-revised)", () => {
    expect(
      resolveFloatingBtnClick(baseState({ highlight: "ai" }), "ai")
    ).toEqual({ type: "translatePageAi" });
  });

  it("page original + no API key → promptConfig, no translation (Q4)", () => {
    expect(
      resolveFloatingBtnClick(baseState({ hasApiKey: false }), "ai")
    ).toEqual({ type: "promptConfig" });
  });

  it("AI translation displayed + AI highlighted → noop (Q16-revised)", () => {
    expect(
      resolveFloatingBtnClick(
        baseState({ pageLanguageState: "translated", displayMode: "ai", highlight: "ai" }),
        "ai"
      )
    ).toEqual({ type: "noop" });
  });

  it("AI request in-flight → noop (Q16-revised)", () => {
    expect(
      resolveFloatingBtnClick(baseState({ aiInFlight: true }), "ai")
    ).toEqual({ type: "noop" });
  });

  it("AI failed blocks exist → retryAi (Q8)", () => {
    expect(
      resolveFloatingBtnClick(
        baseState({ pageLanguageState: "translated", displayMode: "google", hasAiFailedBlocks: true }),
        "ai"
      )
    ).toEqual({ type: "retryAi" });
  });

  it("Google displayed + newLine + AI result available → showAiOnly, zero requests (Q10a)", () => {
    expect(
      resolveFloatingBtnClick(
        baseState({
          pageLanguageState: "translated",
          displayMode: "google",
          aiResultAvailable: true,
          whereToDisplayTranslatedText: "newLine",
        }),
        "ai"
      )
    ).toEqual({ type: "showAiOnly" });
  });

  it("Google displayed + replaceOriginal → translatePageAi re-request (cache-backed, Q10a/Q17)", () => {
    expect(
      resolveFloatingBtnClick(
        baseState({
          pageLanguageState: "translated",
          displayMode: "google",
          aiResultAvailable: true,
          whereToDisplayTranslatedText: "replaceOriginal",
        }),
        "ai"
      )
    ).toEqual({ type: "translatePageAi" });
  });

  it("Google displayed + newLine + no AI result yet → translatePageAi (Q17 best-effort)", () => {
    expect(
      resolveFloatingBtnClick(
        baseState({
          pageLanguageState: "translated",
          displayMode: "google",
          aiResultAvailable: false,
          whereToDisplayTranslatedText: "newLine",
        }),
        "ai"
      )
    ).toEqual({ type: "translatePageAi" });
  });

  it("Google displayed + no key → promptConfig takes priority over retry/switch", () => {
    expect(
      resolveFloatingBtnClick(
        baseState({
          pageLanguageState: "translated",
          displayMode: "google",
          hasApiKey: false,
          hasAiFailedBlocks: true,
        }),
        "ai"
      )
    ).toEqual({ type: "promptConfig" });
  });
});

// ──────────────────────────────────────────────
// resolveInitialUiState — event-absence testing (A3)
// UI rebuild (SPA navigation) cannot rely on change events: events only
// fire when engine state CHANGES. After SPA nav the engine state survives
// unchanged → no event → the rebuilt button group must derive its initial
// highlight/displayMode from the engine's live state.
// ──────────────────────────────────────────────

describe("resolveInitialUiState — event-absence initialization", () => {
  it("engine original → Original highlight + displayMode", () => {
    expect(
      resolveInitialUiState({
        pageLanguageState: "original",
        aiRenderState: "idle",
        aiModeActive: true,
      })
    ).toEqual({ highlight: "original", displayMode: "original" });
  });

  it("engine translated + AI flow started (success) → AI highlight + displayMode", () => {
    expect(
      resolveInitialUiState({
        pageLanguageState: "translated",
        aiRenderState: "success",
        aiModeActive: true,
      })
    ).toEqual({ highlight: "ai", displayMode: "ai" });
  });

  it("engine translated + AI flow started (loading, re-restore in progress) → AI highlight", () => {
    expect(
      resolveInitialUiState({
        pageLanguageState: "translated",
        aiRenderState: "loading",
        aiModeActive: true,
      })
    ).toEqual({ highlight: "ai", displayMode: "ai" });
  });

  it("engine translated + AI flow started (error, click = retry) → AI highlight", () => {
    expect(
      resolveInitialUiState({
        pageLanguageState: "translated",
        aiRenderState: "error",
        aiModeActive: true,
      })
    ).toEqual({ highlight: "ai", displayMode: "ai" });
  });

  it("engine translated + aiModeActive default true but AI never started → Google highlight (auto-translate path)", () => {
    // aiModeActive defaults to true (Q5) even when the user never clicked
    // anything — the auto-translate path. aiRenderState === "idle" means
    // the AI flow never started, so the highlight must be Google, not AI.
    expect(
      resolveInitialUiState({
        pageLanguageState: "translated",
        aiRenderState: "idle",
        aiModeActive: true,
      })
    ).toEqual({ highlight: "google", displayMode: "google" });
  });

  it("engine translated + user switched away from AI (aiModeActive false) → Google highlight", () => {
    expect(
      resolveInitialUiState({
        pageLanguageState: "translated",
        aiRenderState: "success",
        aiModeActive: false,
      })
    ).toEqual({ highlight: "google", displayMode: "google" });
  });
});
