/**
 * Tests for src/contentScript/intentDerivation.js — the single derivation
 * implementation converged from three mirrored copies (plan 51, C06–C08):
 * `currentPageIntentMode` (pageTranslator.js), `deriveIntentUi`
 * (uiStateStore.js) and `resolveInitialUiState` (floatingBtnClickResolver.js)
 * now all delegate to `derivePageIntent`.
 *
 * Contract: frozen plan-30 semantics — a truth table over
 * {original, translated} × {idle, loading, success, error} × {active, off}.
 * The legacy inline formula is carried as a frozen literal below so any
 * behavior drift in the migration (or later) turns this suite RED.
 */
import { describe, expect, it } from "vitest";
import { derivePageIntent } from "../../src/contentScript/intentDerivation.js";
import { resolveInitialUiState } from "../../src/contentScript/floatingBtnClickResolver.js";
import * as store from "../../src/contentScript/uiStateStore.js";

/**
 * Frozen copy of the pre-migration formula (pageTranslator / deriveIntentUi /
 * resolver all expanded to this before plan 51).
 */
function legacyDerive(e) {
  if (e.pageLanguageState !== "translated") return "original";
  const aiIntent =
    e.pageLanguageState === "translated" && e.aiModeActive && e.aiRenderState !== "idle";
  const mode = e.pageLanguageState === "translated" ? (aiIntent ? "ai" : "google") : "original";
  return mode;
}

const TABLE = [];
for (const pageLanguageState of ["original", "translated"]) {
  for (const aiRenderState of ["idle", "loading", "success", "error"]) {
    for (const aiModeActive of [true, false]) {
      TABLE.push({ pageLanguageState, aiRenderState, aiModeActive });
    }
  }
}

describe("derivePageIntent — single derivation (plan 51)", () => {
  it("matches the frozen legacy formula across the full truth table", () => {
    for (const e of TABLE) {
      expect(derivePageIntent(e), JSON.stringify(e)).toBe(legacyDerive(e));
    }
  });

  it("frozen literal expectations (the semantics the family fixes pinned)", () => {
    expect(
      derivePageIntent({ pageLanguageState: "original", aiRenderState: "success", aiModeActive: true })
    ).toBe("original");
    expect(
      derivePageIntent({ pageLanguageState: "translated", aiRenderState: "idle", aiModeActive: true })
    ).toBe("google");
    expect(
      derivePageIntent({ pageLanguageState: "translated", aiRenderState: "loading", aiModeActive: true })
    ).toBe("ai");
    expect(
      derivePageIntent({ pageLanguageState: "translated", aiRenderState: "success", aiModeActive: true })
    ).toBe("ai");
    expect(
      derivePageIntent({ pageLanguageState: "translated", aiRenderState: "error", aiModeActive: true })
    ).toBe("ai"); // click = retry (plan 30 §〇)
    expect(
      derivePageIntent({ pageLanguageState: "translated", aiRenderState: "success", aiModeActive: false })
    ).toBe("google");
  });
});

describe("resolveInitialUiState — converged consumer parity", () => {
  it("highlight === displayMode === derivation across the truth table", () => {
    for (const e of TABLE) {
      const mode = legacyDerive(e);
      expect(resolveInitialUiState(e), JSON.stringify(e)).toEqual({ highlight: mode, displayMode: mode });
    }
  });
});

describe("uiStateStore — store entry point parity (watchdog converges to the derivation)", () => {
  it("watchdog corrects highlight to the derivation for every table row", () => {
    for (const e of TABLE) {
      store.__resetForTest();
      store.setState({ ...e });
      expect(store.getState().highlight, JSON.stringify(e)).toBe(legacyDerive(e));
    }
  });
});
