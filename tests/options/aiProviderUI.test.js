import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import {
  getNormalizedAIProvider,
  updateAIProviderUI,
} from "../../src/options/aiProviderUI.js";

function createDom() {
  const html = `
    <div id="root">
      <div id="genericAiSettings" class="ai-provider-settings"></div>
    </div>
  `;
  return new JSDOM(html).window.document;
}

describe("aiProviderUI", () => {
  it("returns provider id as-is (no registry normalization needed)", () => {
    expect(getNormalizedAIProvider("openrouter")).toBe("openrouter");
    expect(getNormalizedAIProvider("unknown-provider")).toBe("unknown-provider");
    expect(getNormalizedAIProvider("")).toBe("openai");
  });

  it("shows generic panel for any provider", () => {
    const document = createDom();
    const result = updateAIProviderUI(document, "anthropic");
    expect(result).toBe("anthropic");
    expect(document.querySelector("#genericAiSettings").style.display).toBe("block");
  });

  it("shows generic panel for unknown providers too", () => {
    const document = createDom();
    const result = updateAIProviderUI(document, "invalid-provider");
    expect(result).toBe("invalid-provider");
    expect(document.querySelector("#genericAiSettings").style.display).toBe("block");
  });
});
