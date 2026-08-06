import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { refreshAiModelSelect } from "../../src/options/aiModelRefresh.js";

function createSelect() {
  const document = new JSDOM("<select></select>").window.document;
  return document.querySelector("select");
}

describe("aiModelRefresh", () => {
  it("renders fallback notice immediately when required config is missing", async () => {
    const select = createSelect();
    const loadOptions = vi.fn();

    await refreshAiModelSelect({
      select,
      storedValue: "gpt-4o-mini",
      fallbackOptions: [{ value: "gpt-4o-mini", text: "gpt-4o-mini" }],
      missingConfigNotice: "Please enter API key",
      loadOptions,
    });

    expect(loadOptions).not.toHaveBeenCalled();
    expect(select.disabled).toBe(false);
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      "Please enter API key",
      "gpt-4o-mini",
    ]);
  });

  it("renders loaded options and updates fallback cache through callback", async () => {
    const select = createSelect();
    const fallback = [{ value: "legacy-model", text: "legacy-model" }];

    await refreshAiModelSelect({
      select,
      storedValue: "openai/gpt-4o-mini",
      fallbackOptions: fallback,
      loadOptions: vi.fn().mockResolvedValue([
        { value: "openai/gpt-4o-mini", text: "OpenAI GPT-4o Mini" },
        { value: "anthropic/claude-3.5-haiku", text: "Claude 3.5 Haiku" },
      ]),
      onLoadedOptions: (normalizedOptions) => {
        fallback.splice(0, fallback.length, ...normalizedOptions);
      },
    });

    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      "OpenAI GPT-4o Mini",
      "Claude 3.5 Haiku",
    ]);
    expect(fallback).toEqual([
      { value: "openai/gpt-4o-mini", text: "OpenAI GPT-4o Mini" },
      { value: "anthropic/claude-3.5-haiku", text: "Claude 3.5 Haiku" },
    ]);
  });

  it("falls back with error notice when errorToNotice is provided", async () => {
    const select = createSelect();

    await refreshAiModelSelect({
      select,
      fallbackOptions: [{ value: "gpt-4o-mini", text: "gpt-4o-mini" }],
      loadOptions: vi.fn().mockRejectedValue(new Error("Unable to load OpenAI models")),
      errorToNotice: (error) => error.message,
    });

    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      "Unable to load OpenAI models",
      "gpt-4o-mini",
    ]);
  });

  it("falls back silently when errorToNotice is omitted", async () => {
    const select = createSelect();

    await refreshAiModelSelect({
      select,
      fallbackOptions: [{ value: "claude-3-haiku", text: "claude-3-haiku" }],
      loadOptions: vi.fn().mockRejectedValue(new Error("network error")),
    });

    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      "claude-3-haiku",
    ]);
  });
});