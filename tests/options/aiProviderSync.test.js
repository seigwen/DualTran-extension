import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import {
  handleAiConfigChange,
  syncAiProviderSelection,
  syncAiStorageChanges,
} from "../../src/options/aiProviderSync.js";

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
      <input id="apiKeyAzureOpenAI" />
      <input id="azureOpenAIEndpoint" />
      <input id="openRouterApiBase" />
    </div>
  `;
  return new JSDOM(html).window.document;
}

describe("aiProviderSync", () => {
  it("syncs provider selection to select and visible panel", () => {
    const document = createDom();
    const select = document.querySelector("#aiProvider");

    const normalized = syncAiProviderSelection({
      root: document,
      aiProviderSelect: select,
      provider: "google-gemini",
    });

    expect(normalized).toBe("google-gemini");
    expect(select.value).toBe("google-gemini");
    expect(document.querySelector("#genericAiSettings").style.display).toBe("block");
  });

  it("handles aiProvider config changes via shared sync path", () => {
    const document = createDom();
    const select = document.querySelector("#aiProvider");

    const handled = handleAiConfigChange({
      name: "aiProvider",
      newValue: "openrouter",
      root: document,
      aiProviderSelect: select,
    });

    expect(handled).toBe(true);
    expect(select.value).toBe("openrouter");
    expect(document.querySelector("#genericAiSettings").style.display).toBe("block");
  });

  it("updates input values and runs mapped refreshers for API key changes", () => {
    const document = createDom();
    const refreshers = {
      openai: vi.fn(),
      googleGemini: vi.fn(),
      azureOpenAI: vi.fn(),
      openrouter: vi.fn(),
    };

    expect(handleAiConfigChange({
      name: "apiKeyOpenAI",
      newValue: "openai-key",
      root: document,
      refreshers,
    })).toBe(true);
    expect(document.querySelector("#apiKeyOpenAI").value).toBe("openai-key");
    expect(refreshers.openai).toHaveBeenCalledWith("openai-key");

    expect(handleAiConfigChange({
      name: "apiKeyGoogleGemini",
      newValue: "gemini-key",
      root: document,
      refreshers,
    })).toBe(true);
    expect(document.querySelector("#apiKeyGoogleGemini").value).toBe("gemini-key");
    expect(refreshers.googleGemini).toHaveBeenCalledWith("gemini-key");

    expect(handleAiConfigChange({
      name: "azureOpenAIEndpoint",
      newValue: "https://example.openai.azure.com",
      root: document,
      refreshers,
    })).toBe(true);
    expect(document.querySelector("#azureOpenAIEndpoint").value).toBe("https://example.openai.azure.com");
    expect(refreshers.azureOpenAI).toHaveBeenCalledWith("https://example.openai.azure.com");

    expect(handleAiConfigChange({
      name: "openRouterApiBase",
      newValue: "http://127.0.0.1:8787/openrouter/v1/chat/completions",
      root: document,
      refreshers,
    })).toBe(true);
    expect(document.querySelector("#openRouterApiBase").value).toBe("http://127.0.0.1:8787/openrouter/v1/chat/completions");
    expect(refreshers.openrouter).toHaveBeenCalledWith("http://127.0.0.1:8787/openrouter/v1/chat/completions");
  });

  it("updates storage-backed fields without refresh callbacks", () => {
    const document = createDom();
    const select = document.querySelector("#aiProvider");

    syncAiStorageChanges({
      root: document,
      aiProviderSelect: select,
      changes: {
        aiProvider: { newValue: "openrouter" },
        apiKeyOpenAI: { newValue: "synced-openai-key" },
        openRouterApiBase: { newValue: "https://openrouter.example/v1" },
      },
    });

    expect(select.value).toBe("openrouter");
    expect(document.querySelector("#genericAiSettings").style.display).toBe("block");
    expect(document.querySelector("#apiKeyOpenAI").value).toBe("synced-openai-key");
    expect(document.querySelector("#openRouterApiBase").value).toBe("https://openrouter.example/v1");
  });
});
