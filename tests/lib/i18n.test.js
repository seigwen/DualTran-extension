// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("i18n", () => {
  let originalDocumentDescriptor;

  beforeEach(() => {
    vi.resetModules();
    originalDocumentDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "document"
    );
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    delete globalThis.chrome;
    if (originalDocumentDescriptor) {
      Object.defineProperty(globalThis, "document", originalDocumentDescriptor);
    }
  });

  async function loadI18n(opts = {}) {
    globalThis.chrome = {
      i18n: {
        getMessage: vi.fn((key, subs) => {
          if (opts.messages && Object.hasOwn(opts.messages, key)) {
            return opts.messages[key];
          }
          return subs ? `${key}:${subs}` : `translated:${key}`;
        }),
        getUILanguage: vi.fn(() => "en"),
      },
      tabs: opts.hasTabs ? {} : undefined,
    };

    await import("../../src/lib/i18n.js");
  }

  it("adds chrome.i18n.translateDocument on import", async () => {
    await loadI18n();

    expect(chrome.i18n.translateDocument).toBeTypeOf("function");
  });

  it("translates elements with data-i18n", async () => {
    await loadI18n();
    const root = document.createElement("div");
    root.innerHTML = '<span data-i18n="hello">before</span>';

    chrome.i18n.translateDocument(root);

    expect(root.querySelector("span")?.textContent).toBe("translated:hello");
  });

  it("translates data-i18n-title attributes", async () => {
    await loadI18n();
    const root = document.createElement("div");
    root.innerHTML = '<button data-i18n-title="tooltip"></button>';

    chrome.i18n.translateDocument(root);

    expect(root.querySelector("button")?.getAttribute("title")).toBe(
      "translated:tooltip"
    );
  });

  it("translates data-i18n-placeholder attributes", async () => {
    await loadI18n();
    const root = document.createElement("div");
    root.innerHTML = '<input data-i18n-placeholder="search" />';

    chrome.i18n.translateDocument(root);

    expect(root.querySelector("input")?.getAttribute("placeholder")).toBe(
      "translated:search"
    );
  });

  it("translates data-i18n-label attributes", async () => {
    await loadI18n();
    const root = document.createElement("div");
    root.innerHTML = '<input data-i18n-label="fieldName" />';

    chrome.i18n.translateDocument(root);

    expect(root.querySelector("input")?.getAttribute("label")).toBe(
      "translated:fieldName"
    );
  });

  it("passes data-i18n-ph-value substitutions to getMessage", async () => {
    await loadI18n();
    const root = document.createElement("div");
    root.innerHTML =
      '<span data-i18n="welcome" data-i18n-ph-value="World"></span>';

    chrome.i18n.translateDocument(root);

    expect(chrome.i18n.getMessage).toHaveBeenCalledWith("welcome", "World");
    expect(root.querySelector("span")?.textContent).toBe("welcome:World");
  });

  it("skips elements when getMessage returns an empty string", async () => {
    await loadI18n({ messages: { hello: "" } });
    const root = document.createElement("div");
    root.innerHTML = '<span data-i18n="hello">before</span>';

    chrome.i18n.translateDocument(root);

    expect(root.querySelector("span")?.textContent).toBe("before");
  });

  it("defaults to document when called without a root", async () => {
    document.body.innerHTML = '<span data-i18n="hello">before</span>';
    await loadI18n();

    chrome.i18n.translateDocument();

    expect(document.querySelector("span")?.textContent).toBe(
      "translated:hello"
    );
  });

  it("logs and returns when called without a root and no document exists", async () => {
    await loadI18n();
    Object.defineProperty(globalThis, "document", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    expect(() => chrome.i18n.translateDocument()).not.toThrow();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("can not run because it is running in a context")
    );
  });

  it("auto-runs translateDocument when chrome.tabs exists", async () => {
    document.body.innerHTML = '<span data-i18n="hello">before</span>';

    await loadI18n({ hasTabs: true });

    expect(document.querySelector("span")?.textContent).toBe(
      "translated:hello"
    );
  });
});
