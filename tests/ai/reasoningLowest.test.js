/**
 * Lowest-effort sentinel — shared by every host that offers a reasoning setting.
 *
 * The value itself is never sent to a provider: hosts resolve it against the
 * selected model's declared (and dialect-clipped) options at request time, so
 * "lowest" keeps meaning the smallest level THAT model accepts as the user
 * switches models.
 */
import { describe, expect, it } from "vitest";
import {
  LOWEST_REASONING,
  buildReasoningDepthOptions,
  resolveReasoningDepth,
} from "../../src/core/providers/reasoningDepth.js";

const options = (...values) => values.map((value) => ({ value }));

describe("resolveReasoningDepth", () => {
  it("maps the sentinel onto the lowest explicit level the model accepts", () => {
    expect(resolveReasoningDepth({ setting: LOWEST_REASONING, options: options("", "minimal", "low", "high") })).toBe("minimal");
    expect(resolveReasoningDepth({ setting: LOWEST_REASONING, options: options("", "low", "medium") })).toBe("low");
    expect(resolveReasoningDepth({ setting: LOWEST_REASONING, options: options("", "none", "high") })).toBe("none");
    expect(resolveReasoningDepth({ setting: LOWEST_REASONING, options: options("", "low", "none") })).toBe("none");
  });

  it("sends nothing for toggle-only models, empty lists and provider-default", () => {
    // A toggle model expands to "high" only — that is the ON switch, not a low level.
    expect(resolveReasoningDepth({ setting: LOWEST_REASONING, options: options("", "high") })).toBe("");
    expect(resolveReasoningDepth({ setting: LOWEST_REASONING, options: options("") })).toBe("");
    expect(resolveReasoningDepth({ setting: LOWEST_REASONING, options: [] })).toBe("");
    expect(resolveReasoningDepth({ setting: "", options: options("", "low") })).toBe("");
  });

  it("passes explicit levels through untouched", () => {
    expect(resolveReasoningDepth({ setting: "medium", options: options("", "minimal", "medium") })).toBe("medium");
    expect(resolveReasoningDepth({ setting: "xhigh", options: options("") })).toBe("xhigh");
  });

  it("resolves against the core's own option list (dialect clipping preserved)", () => {
    const clipped = buildReasoningDepthOptions({
      provider: "google-gemini",
      npm: "@ai-sdk/google",
      reasoningOptions: [{ type: "effort", values: ["minimal", "low", "medium", "high"] }],
    });
    expect(resolveReasoningDepth({ setting: LOWEST_REASONING, options: clipped })).toBe("minimal");
  });
});
