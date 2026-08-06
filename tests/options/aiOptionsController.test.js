import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { createAiOptionsController } from "../../src/options/aiOptionsController.js";

function createDom() {
  const html = `
    <div id="root">
      <select id="aiProvider">
        <option value="openai">OpenAI</option>
        <option value="openrouter">OpenRouter</option>
        <option value="google-gemini">Google Gemini</option>
      </select>
      <div id="genericAiSettings" class="ai-provider-settings"></div>
      <div id="genericAiSettings" class="ai-provider-settings"></div>
      <div id="genericAiSettings" class="ai-provider-settings"></div>
      <input id="apiKeyOpenAI" />
      <input id="apiKeyGoogleGemini" />
    </div>
  `;
  return new JSDOM(html).window.document;
}

describe("aiOptionsController", () => {
  it("initializes provider selection from config", () => {
    const document = createDom();
    const select = document.querySelector("#aiProvider");
    const controller = createAiOptionsController({
      root: document,
      aiProviderSelect: select,
      config: { get: vi.fn().mockReturnValue("google-gemini") },
    });

    controller.initialize();

    expect(select.value).toBe("google-gemini");
    expect(document.querySelector("#genericAiSettings").style.display).toBe("block");
  });

  it("handles provider changes by syncing UI and refreshing current provider", () => {
    const document = createDom();
    const select = document.querySelector("#aiProvider");
    const config = { set: vi.fn(), get: vi.fn().mockReturnValue("openai") };
    const refreshCurrentProvider = vi.fn();
    const controller = createAiOptionsController({
      root: document,
      aiProviderSelect: select,
      config,
      refreshCurrentProvider,
    });

    controller.handleProviderChange("openrouter");

    expect(config.set).toHaveBeenCalledWith("aiProvider", "openrouter");
    expect(config.set).toHaveBeenCalledWith("activeProviderId", "openrouter");
    expect(select.value).toBe("openrouter");
    expect(document.querySelector("#genericAiSettings").style.display).toBe("block");
    expect(refreshCurrentProvider).toHaveBeenCalledWith("openrouter");
  });

  it("delegates config changes through shared sync logic", () => {
    const document = createDom();
    const select = document.querySelector("#aiProvider");
    const refreshers = { googleGemini: vi.fn() };
    const controller = createAiOptionsController({
      root: document,
      aiProviderSelect: select,
      refreshers,
    });

    const handled = controller.handleConfigChanged("apiKeyGoogleGemini", "gemini-key");

    expect(handled).toBe(true);
    expect(document.querySelector("#apiKeyGoogleGemini").value).toBe("gemini-key");
    expect(refreshers.googleGemini).toHaveBeenCalledWith("gemini-key");
  });

  it("handles storage changes only for local area", () => {
    const document = createDom();
    const select = document.querySelector("#aiProvider");
    const controller = createAiOptionsController({
      root: document,
      aiProviderSelect: select,
    });

    controller.handleStorageChanged({ aiProvider: { newValue: "openrouter" } }, "sync");
    expect(select.value).toBe("openai");

    controller.handleStorageChanged({
      aiProvider: { newValue: "openrouter" },
      apiKeyOpenAI: { newValue: "openai-key" },
    }, "local");
    expect(select.value).toBe("openrouter");
    expect(document.querySelector("#apiKeyOpenAI").value).toBe("openai-key");
  });
});