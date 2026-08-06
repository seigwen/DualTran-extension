import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import {
  renderFallbackState,
  renderLoadingState,
  renderModelOptions,
} from "../../src/options/aiModelSelect.js";

function createSelect() {
  const document = new JSDOM("<select></select>").window.document;
  return document.querySelector("select");
}

describe("aiModelSelect", () => {
  it("renders loading state", () => {
    const select = createSelect();
    renderLoadingState(select);

    expect(select.disabled).toBe(true);
    expect(select.options).toHaveLength(1);
    expect(select.options[0].textContent).toBe("Loading...");
    expect(select.options[0].disabled).toBe(true);
  });

  it("renders fallback state with notice and preserved stored value", () => {
    const select = createSelect();
    renderFallbackState(select, {
      notice: "Please enter API key",
      fallbackOptions: [{ value: "gpt-4o-mini", text: "gpt-4o-mini" }],
      storedValue: "gpt-4o-preview",
    });

    expect(select.disabled).toBe(false);
    expect(Array.from(select.options).map((option) => option.value)).toEqual(["", "gpt-4o-mini", "gpt-4o-preview"]);
    expect(select.value).toBe("gpt-4o-preview");
  });

  it("renders model options and selects the first available option by default", () => {
    const select = createSelect();
    const normalized = renderModelOptions(select, {
      models: [
        { id: "gpt-4o-mini", name: "GPT-4o mini" },
        { id: "gpt-4.1-mini", name: "GPT-4.1 mini" },
      ],
      getValue: (model) => model.id,
      getLabel: (model) => model.name,
    });

    expect(normalized).toEqual([
      { value: "gpt-4o-mini", text: "GPT-4o mini" },
      { value: "gpt-4.1-mini", text: "GPT-4.1 mini" },
    ]);
    expect(select.disabled).toBe(false);
    expect(select.value).toBe("gpt-4o-mini");
  });
});