import { describe, expect, it } from "vitest";
import { sortProvidersByLabel } from "../../src/options/aiProviderUI.js";

const provider = (id, name) => ({ id, name });
const label = (p) => p.label || p.name;

describe("sortProvidersByLabel", () => {
  it("orders providers by their displayed name", () => {
    const list = [
      provider("openrouter", "OpenRouter"),
      provider("anthropic", "Anthropic"),
      provider("deepseek", "DeepSeek"),
      provider("openai", "OpenAI"),
    ];
    expect(sortProvidersByLabel(list, label).map((p) => p.name)).toEqual([
      "Anthropic",
      "DeepSeek",
      "OpenAI",
      "OpenRouter",
    ]);
  });

  it("sorts by the localized label, not the raw registry name", () => {
    const list = [
      { id: "zhipu", name: "Zhipu", label: "智谱 GLM" },
      { id: "anthropic", name: "Anthropic", label: "Anthropic" },
      { id: "baidu", name: "Baidu", label: "百度千帆" },
    ];
    const ordered = sortProvidersByLabel(list, label).map((p) => p.id);
    expect(ordered[0]).toBe("anthropic");
    expect(ordered.slice(1).sort()).toEqual(["baidu", "zhipu"]);
  });

  it("does not mutate the input array", () => {
    const list = [provider("b", "B"), provider("a", "A")];
    const snapshot = list.slice();
    sortProvidersByLabel(list, label);
    expect(list).toEqual(snapshot);
  });

  it("tolerates missing names and empty input", () => {
    expect(sortProvidersByLabel([], label)).toEqual([]);
    expect(sortProvidersByLabel(null, label)).toEqual([]);
    const ordered = sortProvidersByLabel([provider("x", ""), provider("y", "Alpha")], label);
    expect(ordered.map((p) => p.id)).toEqual(["y", "x"]);
  });
});
