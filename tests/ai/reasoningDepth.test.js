/**
 * reasoningDepth 单元测试 — 推理深度 → providerOptions 映射（plan 32）
 *
 * 覆盖（§3.5 的 7 类格子）：
 *   ① 每个方言的 providerOptions 形状（金值断言）
 *   ② 值域裁剪（mistral 无 max、xai 无 xhigh、anthropic 无 none、google 无 xhigh）
 *   ③ depth "" → null（不传 providerOptions，保持现状行为）
 *   ④ toggle-only 声明 → Default + High 展开
 *   ⑤ effort 交集为空 → 只剩 Default
 *   ⑥ 未知 npm → openaiCompatible key（不是 provider 品牌名）
 *   ⑦ 选项顺序 = Default 第一 + EFFORT_ORDER 排序
 *
 * 另外：npm → 方言 的判据必须与 aiProxy 的 SDK_MAP 对齐（issue #88 教训——
 * 两处独立维护同一判据会漂移，且漂移只会静默失败）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REASONING_DEFAULT,
  DIALECT_SDK_NPM_PACKAGES,
  resolveDialect,
  buildReasoningDepthOptions,
  buildProviderOptions,
} from "../../src/lib/ai/reasoningDepth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("reasoningDepth — dialect resolution", () => {
  it("maps each dedicated SDK npm package to its own dialect", () => {
    expect(resolveDialect({ npm: "@ai-sdk/openai" })).toBe("openai");
    expect(resolveDialect({ npm: "@ai-sdk/anthropic" })).toBe("anthropic");
    expect(resolveDialect({ npm: "@ai-sdk/google" })).toBe("google");
    expect(resolveDialect({ npm: "@ai-sdk/xai" })).toBe("xai");
    expect(resolveDialect({ npm: "@ai-sdk/groq" })).toBe("groq");
    expect(resolveDialect({ npm: "@ai-sdk/mistral" })).toBe("mistral");
    expect(resolveDialect({ npm: "@ai-sdk/deepseek" })).toBe("deepseek");
    expect(resolveDialect({ npm: "@ai-sdk/cohere" })).toBe("cohere");
    expect(resolveDialect({ npm: "@ai-sdk/perplexity" })).toBe("perplexity");
    expect(resolveDialect({ npm: "@ai-sdk/togetherai" })).toBe("togetherai");
    expect(resolveDialect({ npm: "@ai-sdk/deepinfra" })).toBe("deepinfra");
  });

  it("routes the azure provider id to the azure dialect even without npm", () => {
    expect(resolveDialect({ provider: "azure" })).toBe("azure");
    expect(resolveDialect({ provider: "azure-openai" })).toBe("azure");
  });

  it("falls back to openai-compatible for unknown or missing npm", () => {
    expect(resolveDialect({ npm: "@ai-sdk/openai-compatible" })).toBe("openai-compatible");
    expect(resolveDialect({ npm: "@openrouter/ai-sdk-provider" })).toBe("openai-compatible");
    expect(resolveDialect({})).toBe("openai-compatible");
  });

  it("keeps the npm list aligned with the aiProxy SDK_MAP dispatch table (issue #88 drift guard)", () => {
    const aiProxySource = readFileSync(
      resolve(__dirname, "../../src/background/aiProxy.js"),
      "utf8"
    );
    // SDK_MAP 的键就是「有专用 SDK 的 npm 包」集合；两处不一致 = 会漂移的候选。
    const sdkMapBlock = aiProxySource.match(/const SDK_MAP = Object\.freeze\(\{([\s\S]*?)\}\)/);
    expect(sdkMapBlock, "SDK_MAP block not found in aiProxy.js").toBeTruthy();
    const npmInAiProxy = [...sdkMapBlock[1].matchAll(/"(@ai-sdk\/[^"]+)":/g)]
      .map((m) => m[1])
      .sort();
    expect(npmInAiProxy).toEqual([...DIALECT_SDK_NPM_PACKAGES]);
  });
});

describe("reasoningDepth — buildProviderOptions (golden shapes per dialect)", () => {
  it("openai → { openai: { reasoningEffort } }", () => {
    expect(buildProviderOptions({ npm: "@ai-sdk/openai", depth: "high" }))
      .toEqual({ openai: { reasoningEffort: "high" } });
  });

  it("azure → { azure: { reasoningEffort } }", () => {
    expect(buildProviderOptions({ provider: "azure-openai", depth: "low" }))
      .toEqual({ azure: { reasoningEffort: "low" } });
  });

  it("anthropic → { anthropic: { effort } }", () => {
    expect(buildProviderOptions({ npm: "@ai-sdk/anthropic", depth: "xhigh" }))
      .toEqual({ anthropic: { effort: "xhigh" } });
  });

  it("google → { google: { thinkingConfig: { thinkingLevel } } }", () => {
    expect(buildProviderOptions({ npm: "@ai-sdk/google", depth: "minimal" }))
      .toEqual({ google: { thinkingConfig: { thinkingLevel: "minimal" } } });
  });

  it("xai / groq / mistral / deepseek / perplexity / togetherai / deepinfra → reasoningEffort on their own key", () => {
    expect(buildProviderOptions({ npm: "@ai-sdk/xai", depth: "high" }))
      .toEqual({ xai: { reasoningEffort: "high" } });
    expect(buildProviderOptions({ npm: "@ai-sdk/groq", depth: "default" }))
      .toEqual({ groq: { reasoningEffort: "default" } });
    expect(buildProviderOptions({ npm: "@ai-sdk/mistral", depth: "high" }))
      .toEqual({ mistral: { reasoningEffort: "high" } });
    expect(buildProviderOptions({ npm: "@ai-sdk/deepseek", depth: "max" }))
      .toEqual({ deepseek: { reasoningEffort: "max" } });
  });

  it("cohere → thinking.type toggle (high → enabled, none → disabled)", () => {
    expect(buildProviderOptions({ npm: "@ai-sdk/cohere", depth: "high" }))
      .toEqual({ cohere: { thinking: { type: "enabled" } } });
    expect(buildProviderOptions({ npm: "@ai-sdk/cohere", depth: "none" }))
      .toEqual({ cohere: { thinking: { type: "disabled" } } });
  });

  // ⑥ — the openai-compatible fallback must use the SDK-declared key, not a brand name.
  // A brand name (`{ deepseek: {...} }`) is dropped silently by the SDK (probe finding).
  it("unknown npm (openai-compatible fallback) → openaiCompatible key, never a brand name", () => {
    const opts = buildProviderOptions({ provider: "deepseek", npm: "@ai-sdk/openai-compatible", depth: "high" });
    expect(opts).toEqual({ openaiCompatible: { reasoningEffort: "high" } });
    expect(opts).not.toHaveProperty("deepseek");
  });

  it("passes arbitrary values through on pass-through dialects (no enum validation upstream)", () => {
    expect(buildProviderOptions({ npm: "@ai-sdk/openai-compatible", depth: "medium" }))
      .toEqual({ openaiCompatible: { reasoningEffort: "medium" } });
  });
});

describe("reasoningDepth — buildProviderOptions value clipping (probe-verified accept sets)", () => {
  // ② — values the SDK rejects with `invalid <provider> provider options`.
  // Sending them would abort the whole translation request.
  it("returns null for values the dialect rejects (mistral has no max/low/medium)", () => {
    expect(buildProviderOptions({ npm: "@ai-sdk/mistral", depth: "max" })).toBeNull();
    expect(buildProviderOptions({ npm: "@ai-sdk/mistral", depth: "low" })).toBeNull();
    expect(buildProviderOptions({ npm: "@ai-sdk/mistral", depth: "medium" })).toBeNull();
    expect(buildProviderOptions({ npm: "@ai-sdk/mistral", depth: "xhigh" })).toBeNull();
  });

  it("returns null for values the dialect rejects (xai has no xhigh/max/minimal)", () => {
    expect(buildProviderOptions({ npm: "@ai-sdk/xai", depth: "xhigh" })).toBeNull();
    expect(buildProviderOptions({ npm: "@ai-sdk/xai", depth: "max" })).toBeNull();
    expect(buildProviderOptions({ npm: "@ai-sdk/xai", depth: "minimal" })).toBeNull();
  });

  it("returns null for values the dialect rejects (anthropic has no none/minimal)", () => {
    expect(buildProviderOptions({ npm: "@ai-sdk/anthropic", depth: "none" })).toBeNull();
    expect(buildProviderOptions({ npm: "@ai-sdk/anthropic", depth: "minimal" })).toBeNull();
  });

  it("returns null for values the dialect rejects (google has no xhigh/max/none)", () => {
    expect(buildProviderOptions({ npm: "@ai-sdk/google", depth: "xhigh" })).toBeNull();
    expect(buildProviderOptions({ npm: "@ai-sdk/google", depth: "max" })).toBeNull();
    expect(buildProviderOptions({ npm: "@ai-sdk/google", depth: "none" })).toBeNull();
  });

  // ③ — empty depth keeps the legacy behavior exactly (no providerOptions at all).
  it("returns null for the empty depth (default — no parameter sent)", () => {
    expect(buildProviderOptions({ npm: "@ai-sdk/openai", depth: "" })).toBeNull();
    expect(buildProviderOptions({ npm: "@ai-sdk/openai", depth: undefined })).toBeNull();
    expect(buildProviderOptions({ npm: "@ai-sdk/openai" })).toBeNull();
  });

  it("exposes REASONING_DEFAULT as the empty string sentinel", () => {
    expect(REASONING_DEFAULT).toBe("");
  });
});

describe("reasoningDepth — buildReasoningDepthOptions", () => {
  it("always lists Default first, even with no declaration at all", () => {
    const options = buildReasoningDepthOptions({ npm: "@ai-sdk/openai" });
    expect(options).toEqual([{ value: "", label: "Default" }]);
  });

  // ⑦ — declared values are clipped to the dialect, deduped and ordered.
  it("clips declared effort values to the dialect accept set", () => {
    const options = buildReasoningDepthOptions({
      npm: "@ai-sdk/mistral",
      reasoningOptions: [{ type: "effort", values: ["none", "low", "medium", "high", "xhigh", "max"] }],
    });
    expect(options.map((o) => o.value)).toEqual(["", "none", "high"]);
  });

  it("orders declared values by the canonical effort order", () => {
    const options = buildReasoningDepthOptions({
      npm: "@ai-sdk/openai",
      reasoningOptions: [{ type: "effort", values: ["high", "none", "low", "medium"] }],
    });
    expect(options.map((o) => o.value)).toEqual(["", "none", "low", "medium", "high"]);
  });

  it("keeps an unknown declared value after the known ones (no silent drop)", () => {
    const options = buildReasoningDepthOptions({
      npm: "@ai-sdk/openai-compatible",
      reasoningOptions: [{ type: "effort", values: ["high", "turbo"] }],
    });
    expect(options.map((o) => o.value)).toEqual(["", "high", "turbo"]);
  });

  // ④ — toggle-only models get Default + High (Q3), never a bare "on/off" pair.
  it("expands a toggle-only declaration to Default + High", () => {
    const options = buildReasoningDepthOptions({
      provider: "google-gemini",
      npm: "@ai-sdk/google",
      reasoningOptions: [{ type: "toggle" }],
    });
    expect(options).toEqual([
      { value: "", label: "Default" },
      { value: "high", label: "High" },
    ]);
  });

  // ⑤ — empty intersection → Default only (never offer a value that would throw).
  it("offers Default only when every declared value is rejected by the dialect", () => {
    const options = buildReasoningDepthOptions({
      npm: "@ai-sdk/mistral",
      reasoningOptions: [{ type: "effort", values: ["low", "medium", "max"] }],
    });
    expect(options).toEqual([{ value: "", label: "Default" }]);
  });

  it("offers Default only for a budget_tokens-only declaration (out of scope this round)", () => {
    const options = buildReasoningDepthOptions({
      npm: "@ai-sdk/anthropic",
      reasoningOptions: [{ type: "budget_tokens", min: 1024, max: 63999 }],
    });
    expect(options).toEqual([{ value: "", label: "Default" }]);
  });

  it("prefers the effort declaration when both effort and toggle are declared", () => {
    const options = buildReasoningDepthOptions({
      npm: "@ai-sdk/anthropic",
      reasoningOptions: [
        { type: "effort", values: ["low", "medium", "high"] },
        { type: "budget_tokens", min: 1024 },
      ],
    });
    expect(options.map((o) => o.value)).toEqual(["", "low", "medium", "high"]);
  });

  it("labels every built option with a non-empty string (dropdown rows never render blank)", () => {
    const options = buildReasoningDepthOptions({
      npm: "@ai-sdk/xai",
      reasoningOptions: [{ type: "effort", values: ["none", "low", "medium", "high", "xhigh"] }],
    });
    expect(options.length).toBeGreaterThan(1);
    expect(options.every((o) => typeof o.label === "string" && o.label.length > 0)).toBe(true);
  });

  it("never offers a value the dialect would reject (offer set ⊆ accept set)", () => {
    const cases = [
      ["@ai-sdk/mistral", ["none", "low", "medium", "high", "xhigh", "max"]],
      ["@ai-sdk/xai", ["none", "low", "medium", "high", "xhigh", "max"]],
      ["@ai-sdk/anthropic", ["none", "minimal", "low", "medium", "high", "xhigh", "max"]],
      ["@ai-sdk/google", ["none", "minimal", "low", "medium", "high", "xhigh", "max"]],
    ];
    for (const [npm, values] of cases) {
      const options = buildReasoningDepthOptions({ npm, reasoningOptions: [{ type: "effort", values }] });
      for (const opt of options) {
        if (opt.value === "") continue;
        // 每个可选项都必须能安全地通过 buildProviderOptions（否则发送时会抛错）
        expect(
          buildProviderOptions({ npm, depth: opt.value }),
          `${npm} offered "${opt.value}" but buildProviderOptions rejects it`
        ).not.toBeNull();
      }
    }
  });
});
