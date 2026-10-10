/**
 * Engine label single source (spec 47 P2 batch ③, issue #157).
 *
 * The engine row `Original | Google | AI` appears in the floating group, the
 * hover button group, and (for the AI button) the block-state renderers. All
 * three read from engineLabels.js so they can never drift; "Original" is
 * localized through `btnOriginal`, while Google / AI are locale-neutral brand
 * tokens by decision (register category: platform).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_ENGINE_LABEL,
  GOOGLE_ENGINE_LABEL,
  getOriginalButtonLabel,
} from "../../src/contentScript/engineLabels.js";

describe("engine labels (#157 batch ③)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("localizes the Original button through the btnOriginal key", () => {
    vi.stubGlobal("chrome", {
      i18n: { getMessage: (k) => (k === "btnOriginal" ? "原文" : "") },
    });
    expect(getOriginalButtonLabel()).toBe("原文");
  });

  it("falls back to the English Original when no i18n runtime is present", () => {
    // No chrome stub at all — the shared helper's try/catch must absorb the
    // missing runtime and return the English fallback (content-script safety).
    expect(getOriginalButtonLabel()).toBe("Original");
  });

  it("keeps Google / AI as locale-neutral brand tokens (platform register)", () => {
    expect(GOOGLE_ENGINE_LABEL).toBe("Google");
    expect(AI_ENGINE_LABEL).toBe("AI");
  });
});
