import { beforeEach, describe, expect, it, vi } from "vitest";

const { configValues, setTargetLanguageMock } = vi.hoisted(() => {
  const configValues = {
    targetLanguages: ["fr", "de", "es"],
    darkMode: "no",
  };

  return {
    configValues,
    setTargetLanguageMock: vi.fn(),
  };
});

vi.mock("../../src/lib/config.js", () => ({
  default: {
    get: (key) => configValues[key],
    onReady: vi.fn((callback) => {
      if (typeof callback === "function") callback();
      return Promise.resolve();
    }),
    setTargetLanguage: setTargetLanguageMock,
  },
}));

vi.mock("../../src/lib/languages.js", () => ({
  default: {
    getLanguageList: () => ({
      fr: "French",
      en: "English",
      de: "German",
      ar: "Arabic",
    }),
  },
}));

vi.mock("../../src/lib/i18n.js", () => ({}));

describe("popup-change-language", () => {
  function setLocation(value = "popup-change-language.html") {
    delete window.location;
    window.location = value;
  }

  function renderDom() {
    document.head.innerHTML = "";
    document.body.innerHTML = `
      <button id="btnClose"></button>
      <button id="btnApply"></button>
      <select>
        <optgroup name="targets"></optgroup>
        <optgroup name="all"></optgroup>
      </select>
    `;
  }

  async function loadModule() {
    await import("../../src/popup/popup-change-language.js");
  }

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    configValues.targetLanguages = ["fr", "de", "es"];
    configValues.darkMode = "no";
    renderDom();
    setLocation();
    globalThis.matchMedia = vi.fn(() => ({ matches: false }));
  });

  it("navigates back to popup.html when close is clicked", async () => {
    await loadModule();

    document.getElementById("btnClose").click();

    expect(window.location).toBe("popup.html");
  });

  it("applies the selected language and navigates back", async () => {
    await loadModule();
    document.querySelector("select").value = "de";

    document.getElementById("btnApply").click();

    expect(setTargetLanguageMock).toHaveBeenCalledWith("de", true);
    expect(window.location).toBe("popup.html");
  });

  it("populates all languages sorted by label", async () => {
    await loadModule();

    const allOptions = [...document.querySelector('[name="all"]').querySelectorAll("option")];

    expect(allOptions.map((option) => option.value)).toEqual(["ar", "en", "fr", "de"]);
    expect(allOptions.map((option) => option.textContent)).toEqual([
      "Arabic",
      "English",
      "French",
      "German",
    ]);
  });

  it("populates recent target languages in config order", async () => {
    await loadModule();

    const recentOptions = [...document.querySelector('[name="targets"]').querySelectorAll("option")];

    expect(recentOptions.map((option) => option.value)).toEqual(["fr", "de", "es"]);
    expect(recentOptions.map((option) => option.textContent)).toEqual(["French", "German", ""]);
  });

  it("selects the first configured target language on ready", async () => {
    await loadModule();

    expect(document.querySelector("select").value).toBe("fr");
  });

  it("adds the light mode style when dark mode is disabled", async () => {
    configValues.darkMode = "no";

    await loadModule();

    expect(document.getElementById("lightModeElement")).not.toBeNull();
  });

  it("does not add the light mode style when dark mode is enabled", async () => {
    configValues.darkMode = "yes";

    await loadModule();

    expect(document.getElementById("lightModeElement")).toBeNull();
  });

  it("uses system light mode when dark mode is auto and prefers-color-scheme is light", async () => {
    configValues.darkMode = "auto";
    globalThis.matchMedia = vi.fn(() => ({ matches: false }));

    await loadModule();

    expect(document.getElementById("lightModeElement")).not.toBeNull();
  });

  it("uses system dark mode when dark mode is auto and prefers-color-scheme is dark", async () => {
    configValues.darkMode = "auto";
    globalThis.matchMedia = vi.fn(() => ({ matches: true }));

    await loadModule();

    expect(document.getElementById("lightModeElement")).toBeNull();
  });

  it("keeps the selected value when apply is clicked", async () => {
    await loadModule();
    const select = document.querySelector("select");
    select.value = "fr";

    document.getElementById("btnApply").click();

    expect(setTargetLanguageMock).toHaveBeenCalledTimes(1);
    expect(setTargetLanguageMock).toHaveBeenLastCalledWith(select.value, true);
  });
});
