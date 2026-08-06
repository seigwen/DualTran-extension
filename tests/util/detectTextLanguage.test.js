import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/languages.js", () => ({
  default: {
    fixTLanguageCode: vi.fn((code) => {
      const valid = ["en", "zh", "ja", "fr", "de", "es", "und"];
      return valid.includes(code) ? code : null;
    }),
  },
}));

describe("detectTextLanguage", () => {
  beforeEach(() => {
    vi.resetModules();
    globalThis.chrome = {
      i18n: {
        detectLanguage: vi.fn(),
      },
    };
  });

  async function loadModule() {
    const mod = await import("../../src/util/detectTextLanguage.js");
    return mod.default;
  }

  it("returns 'und' if chrome.i18n.detectLanguage is not available", async () => {
    globalThis.chrome.i18n.detectLanguage = undefined;
    const detectTextLanguage = await loadModule();
    const result = await detectTextLanguage("hello");
    expect(result).toBe("und");
  });

  it("returns the first valid language code from detection result", async () => {
    globalThis.chrome.i18n.detectLanguage.mockImplementation((text, cb) => {
      cb({
        isReliable: true,
        languages: [{ language: "en", percentage: 90 }],
      });
    });
    const detectTextLanguage = await loadModule();
    const result = await detectTextLanguage("hello world");
    expect(result).toEqual({ lang: "en", isReliable: true });
  });

  it("skips invalid language codes and returns the first valid one", async () => {
    globalThis.chrome.i18n.detectLanguage.mockImplementation((text, cb) => {
      cb({
        isReliable: false,
        languages: [
          { language: "xx-invalid", percentage: 50 },
          { language: "fr", percentage: 40 },
        ],
      });
    });
    const detectTextLanguage = await loadModule();
    const result = await detectTextLanguage("bonjour");
    expect(result).toEqual({ lang: "fr", isReliable: false });
  });

  it("returns 'und' if no valid languages found", async () => {
    globalThis.chrome.i18n.detectLanguage.mockImplementation((text, cb) => {
      cb({
        isReliable: false,
        languages: [{ language: "zz-unknown", percentage: 100 }],
      });
    });
    const detectTextLanguage = await loadModule();
    const result = await detectTextLanguage("???");
    expect(result).toEqual({ lang: "und", isReliable: false });
  });

  it("returns 'und' if result is null", async () => {
    globalThis.chrome.i18n.detectLanguage.mockImplementation((text, cb) => {
      cb(null);
    });
    const detectTextLanguage = await loadModule();
    const result = await detectTextLanguage("test");
    expect(result).toEqual({ lang: "und", isReliable: false });
  });

  it("returns 'und' if languages array is empty", async () => {
    globalThis.chrome.i18n.detectLanguage.mockImplementation((text, cb) => {
      cb({ isReliable: false, languages: [] });
    });
    const detectTextLanguage = await loadModule();
    const result = await detectTextLanguage("test");
    expect(result).toEqual({ lang: "und", isReliable: false });
  });
});
