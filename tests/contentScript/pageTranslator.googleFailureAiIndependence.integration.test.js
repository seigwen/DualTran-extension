/**
 * Google failure must not disable AI translation (diagnosing-bugs loop).
 *
 * Real-world report: when Google Translate is banned/rate-limited, the Google
 * pass yields empty translations. The page then registers NO AI blocks in
 * newLine mode (registration is gated on the Google word count), so the AI
 * loop finds nothing to translate — the user sees "AI translation also fails"
 * even though the AI provider is healthy.
 *
 * This suite uses the REAL pageTranslator + REAL singletonBtnGroup block
 * registry (only the AI transport is mocked) and drives the exact production
 * seam: addTranslatedContent (Google arrival) → getProxiesForTranslation (AI
 * dispatch).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { applyAiSuccessState } from "../../src/contentScript/aiUiState.js";
import { getAllProxies, getBlockState } from "../../src/contentScript/singletonBtnGroup.js";

const { configValues, translateWithAIMock, sendMessageMock } = vi.hoisted(() => ({
  configValues: {
    aiImproveForLongerThan: 0,
    translatedColor: "#1d4ed8",
    aiTranslatedColor: "#7c3aed",
    whereToDisplayTranslatedText: "newLine",
    dontSortResults: "yes",
    aiProvider: "openai",
    apiKeyOpenAI: "test-key",
    providerConfigs: {},
    enableAiTranslationCache: "no",
    translateLongerThan: 0,
    targetLanguage: "fr",
    targetLanguageTextTranslation: "fr",
    customDictionary: new Map(),
    alwaysTranslateSites: [],
    neverTranslateSites: [],
    neverTranslateLangs: [],
    alwaysTranslateLangs: [],
    alwaysTranslateLangsAI: [],
  },
  translateWithAIMock: vi.fn(),
  sendMessageMock: vi.fn(),
}));

vi.mock("../../src/lib/config.js", () => ({
  default: {
    get: vi.fn((key) => configValues[key]),
    set: vi.fn((key, value) => { configValues[key] = value; }),
    onReady: vi.fn(() => Promise.resolve()),
    onChanged: vi.fn(),
  },
}));

vi.mock("../../src/lib/languages.js", () => ({
  default: {
    fixTLanguageCode: (c) => c,
    codeToLanguageNameInEnglish: (c) => c,
    getAlternativeService: (lang, service) => service,
    otherConfigs: {},
  },
}));
vi.mock("../../src/lib/platformInfo.js", () => ({ default: {} }));
vi.mock("../../src/contentScript/showOriginal.js", () => ({
  default: {
    get isEnabled() { return false; },
    enable: vi.fn(),
    disable: vi.fn(),
    add: vi.fn(),
    enabledObserverSubscribe: vi.fn(),
  },
}));
// mock-fidelity-allow: AI transport is the dispatch target of this suite; the real block registry + pageTranslator are under test
vi.mock("../../src/contentScript/fetchSSE.js", () => ({
  translateWithAI: (...args) => translateWithAIMock(...args),
}));
// mock-fidelity-allow: this suite observes block registration/dispatch, not stream parsing; arrival parsing is pinned by hoverBtnStreamArrival + the cross-level matrix
vi.mock("../../src/contentScript/aiStreamMessage.js", () => ({
  parseOpenAiStyleStreamMessage: vi.fn(() => ({ kind: "done" })),
  parseTaggedPageTranslationProgress: vi.fn(() => null),
  notifyAiStreamParseError: vi.fn(),
}));
vi.mock("toastify-js", () => ({ default: () => ({ showToast: vi.fn() }) }));
vi.mock("gpt-tokenizer", () => ({ encode: (t) => Array.from(t || "") }));
vi.mock("../../src/lib/ai/providerRegistry.js", () => ({
  createProviderRegistry: () => ({
    getProvider: (id) => ({ id, name: id }),
    listProviders: () => [],
  }),
  BUILT_IN_PROVIDERS: [],
}));

function installDom() {
  const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
    url: "https://example.com/article",
    pretendToBeVisual: true,
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  globalThis.top = dom.window;
  globalThis.self = dom.window;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: dom.window.navigator,
  });
  globalThis.chrome = {
    runtime: {
      id: "test-id",
      getURL: (p) => p,
      sendMessage: sendMessageMock.mockImplementation((payload, callback) => {
        if (typeof callback === "function") {
          callback(payload?.action === "getTabHostName" ? "example.com" : undefined);
        }
      }),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: { query: vi.fn(() => Promise.resolve([{ url: "https://example.com" }])) },
    storage: {
      local: { get: vi.fn(() => Promise.resolve({})), set: vi.fn(() => Promise.resolve()) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    i18n: { getMessage: vi.fn((k) => k) },
  };
}

let pageTranslator;
let backgroundTranslateSingleText;

beforeAll(async () => {
  installDom();
  const mod = await import("../../src/contentScript/pageTranslator.js");
  pageTranslator = mod.pageTranslator;
  backgroundTranslateSingleText = mod.backgroundTranslateSingleText;
  await vi.waitFor(() => {
    expect(pageTranslator._addTranslatedContent).toBeTypeOf("function");
    expect(pageTranslator._aiTranslateDynamically).toBeTypeOf("function");
  }, { timeout: 5000 });
});

afterAll(() => {
  try { pageTranslator?.stopAiAutoTranslate?.(); } catch (_) {}
});

beforeEach(() => {
  translateWithAIMock.mockClear();
  sendMessageMock.mockClear();
  sendMessageMock.mockImplementation((payload, callback) => {
    if (typeof callback === "function") {
      callback(payload?.action === "getTabHostName" ? "example.com" : undefined);
    }
  });
  configValues.whereToDisplayTranslatedText = "newLine";
  document.body.innerHTML = "";
});

function makeParagraph(sourceText) {
  const p = document.createElement("p");
  const textNode = document.createTextNode(sourceText);
  p.appendChild(textNode);
  const translatedElement = document.createElement("translated");
  translatedElement.style.display = "none";
  p.appendChild(translatedElement);
  document.body.appendChild(p);
  return {
    piece: { nodes: [textNode], translatedElement, nodesToBeInTranslatedNode: [textNode] },
    textNode,
    translatedElement,
  };
}

describe("Google empty result must not disable AI translation", () => {
  it("control: a normal Google result keeps the source-registered block and AI dispatches", async () => {
    const { piece } = makeParagraph("Control paragraph with normal google output");
    pageTranslator._registerSourceBlocks([piece]);
    await pageTranslator._addTranslatedContent([piece], [["Paragraphe de controle"]]);

    pageTranslator._setForceAiTranslation(true);
    await pageTranslator._aiTranslateDynamically();

    expect(translateWithAIMock).toHaveBeenCalled();
    const content = translateWithAIMock.mock.calls[0][0];
    expect(content).toContain("Control paragraph with normal google output");
  });

  it("banned: an empty Google result never removes the block, and AI still dispatches", async () => {
    const { piece, translatedElement } = makeParagraph("Banned paragraph that google refused to translate");
    pageTranslator._registerSourceBlocks([piece]);
    // A banned Google endpoint resolves with empty strings (serviceBase catches
    // the HTTP error and returns "" per block) — not with null/throw.
    await pageTranslator._addTranslatedContent([piece], [[""]]);

    const st = getBlockState(translatedElement);
    expect(st).not.toBeNull();
    expect(st.googleTranslatedText).toBe("");

    pageTranslator._setForceAiTranslation(true);
    await pageTranslator._aiTranslateDynamically();

    expect(translateWithAIMock).toHaveBeenCalled();
    const content = translateWithAIMock.mock.calls[0][0];
    expect(content).toContain("Banned paragraph that google refused to translate");
  });

  it("AI arrives before Google: the late Google result updates only its channel and never steals the AI display", async () => {
    const { piece, translatedElement } = makeParagraph("AI first paragraph that google was slow to translate");
    pageTranslator._registerSourceBlocks([piece]);

    pageTranslator._setForceAiTranslation(true);
    await pageTranslator._aiTranslateDynamically();
    expect(translateWithAIMock).toHaveBeenCalled();

    // Real arrival writer on the real registry proxy (no mocked state).
    const proxies = getAllProxies();
    expect(proxies.length).toBe(1);
    applyAiSuccessState(proxies[0], { translatedText: "AI arrives first" });

    await pageTranslator._addTranslatedContent([piece], [["Google arrives later"]]);

    const st = getBlockState(translatedElement);
    expect(st.aiStatus).toBe("translated");
    expect(st.aiSpan.textContent).toBe("AI arrives first");
    expect(st.googleSpan.textContent).toBe("Google arrives later");
    expect(st.displayMode).toBe("ai");
    expect(st.googleBtnState).toBe("success");
  });

  it("mode symmetry: replaceOriginal registers on the SOURCE text, so an empty Google result still dispatches AI", async () => {
    configValues.whereToDisplayTranslatedText = "replaceOriginal";
    const textNode = document.createTextNode("Replace original paragraph that google refused");
    const p = document.createElement("p");
    p.appendChild(textNode);
    document.body.appendChild(p);

    const piece = { nodes: [textNode] };
    pageTranslator._registerSourceBlocks([piece]);
    pageTranslator._translateResults([piece], [[""]]);

    pageTranslator._setForceAiTranslation(true);
    await pageTranslator._aiTranslateDynamically();

    expect(translateWithAIMock).toHaveBeenCalled();
    const content = translateWithAIMock.mock.calls[0][0];
    expect(content).toContain("Replace original paragraph that google refused");
  });

  it("replaceOriginal AI-first: a late Google result must not refill the cleared source line", async () => {
    configValues.whereToDisplayTranslatedText = "replaceOriginal";
    const textNode = document.createTextNode("Replace original AI first paragraph");
    const p = document.createElement("p");
    p.appendChild(textNode);
    document.body.appendChild(p);

    const piece = { nodes: [textNode] };
    pageTranslator._registerSourceBlocks([piece]);
    pageTranslator._setForceAiTranslation(true);
    await pageTranslator._aiTranslateDynamically();
    expect(translateWithAIMock).toHaveBeenCalled();

    const proxies = getAllProxies();
    expect(proxies.length).toBe(1);
    applyAiSuccessState(proxies[0], { translatedText: "AI replaces the line first" });
    // AI display cleared the source text node and shows the AI span.
    expect(textNode.textContent).toBe("");

    pageTranslator._translateResults([piece], [["Google arrives later"]]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const st = getBlockState(p);
    expect(st.displayMode).toBe("ai");
    expect(st.aiSpan).toBeNull();
    expect(st.translatedTextNode.textContent).toBe("AI replaces the line first");
    // Google text is kept for a later "show Google" switch, never written into
    // the visible source line while AI owns the display.
    expect(textNode.textContent).toBe("");
  });

  it("restore + retranslate clears stale registrations and re-registers (replaceOriginal source elements survive)", () => {
    configValues.whereToDisplayTranslatedText = "replaceOriginal";
    const textNode = document.createTextNode("Replace original restore paragraph");
    const p = document.createElement("p");
    p.appendChild(textNode);
    document.body.appendChild(p);

    const piece = { nodes: [textNode] };
    pageTranslator._registerSourceBlocks([piece]);
    expect(getBlockState(p)).not.toBeNull();
    expect(p.dataset.dualtranBlock).toBe("1");

    pageTranslator.restorePage(true);

    expect(getBlockState(p)).toBeNull();
    expect(p.dataset.dualtranBlock).toBeUndefined();

    pageTranslator._registerSourceBlocks([piece]);
    expect(getBlockState(p)).not.toBeNull();
    expect(p.querySelectorAll(":scope > .dualtran-aitranslatedtext-replacemode").length).toBe(1);
  });

  it("replaceOriginal: multiple pieces sharing one parent register once (existing anchor semantics)", () => {
    configValues.whereToDisplayTranslatedText = "replaceOriginal";
    const p = document.createElement("p");
    const a = document.createTextNode("First piece in the shared parent");
    const b = document.createTextNode("Second piece in the shared parent");
    p.appendChild(a);
    p.appendChild(b);
    document.body.appendChild(p);

    pageTranslator._registerSourceBlocks([{ nodes: [a] }, { nodes: [b] }]);

    expect(getAllProxies().length).toBe(1);
    expect(p.querySelectorAll(":scope > .dualtran-aitranslatedtext-replacemode").length).toBe(1);
  });

  it("banned page run: pageRenderState becomes error, no empty translation is written (plan 118 / P3)", async () => {
    const p = document.createElement("p");
    const textNode = document.createTextNode("A banned page paragraph that must stay visible in the source language");
    p.appendChild(textNode);
    document.body.appendChild(p);

    sendMessageMock.mockImplementation((payload, callback) => {
      if (typeof callback !== "function") return;
      if (payload?.action === "getTabHostName") return callback("example.com");
      if (payload?.action === "translateHTMLDetailed") {
        const rows = payload.sourceArray2d.map(() => [""]);
        return callback({
          results: rows,
          outcomes: rows.map(() => ({ status: "error", errorMessage: "429 Too Many Requests" })),
        });
      }
      if (payload?.action === "translateSingleTextDetailed") {
        return callback({ result: "", outcome: { status: "error", errorMessage: "429 Too Many Requests" } });
      }
      callback(undefined);
    });

    const states = [];
    pageTranslator.onPageRenderStateChange((state) => states.push(state));

    pageTranslator.translatePage("fr");

    await vi.waitFor(() => expect(states).toContain("error"), { timeout: 5000 });

    const translated = document.querySelector("translated");
    expect(translated).not.toBeNull();
    expect(translated.textContent).toBe("");
    expect(textNode.textContent).toContain("must stay visible");

    const st = getBlockState(translated);
    expect(st.googleBtnState).toBe("error");
    expect(st.googleError).toContain("429");
    expect(st.displayMode).not.toBe("google");
  });

  it("partial ban: successful pieces still render, failed pieces stay original and mark error (plan 118 / P3)", async () => {
    // A >1000-char block forces the scan to start a new piece, so the batch
    // can carry one success row + one failure row.
    const p1 = document.createElement("p");
    const t1 = document.createTextNode("Alpha paragraph that google translated " + "x".repeat(1100));
    p1.appendChild(t1);
    document.body.appendChild(p1);
    const p2 = document.createElement("p");
    const t2 = document.createTextNode("Beta paragraph that google refused");
    p2.appendChild(t2);
    document.body.appendChild(p2);

    sendMessageMock.mockImplementation((payload, callback) => {
      if (typeof callback !== "function") return;
      if (payload?.action === "getTabHostName") return callback("example.com");
      if (payload?.action === "translateHTMLDetailed") {
        const rows = payload.sourceArray2d.map((row) =>
          row.map((text) => (String(text).startsWith("Alpha") ? `FR:${text}` : ""))
        );
        const outcomes = payload.sourceArray2d.map((row) => ({
          status: String(row[0]).startsWith("Alpha") ? "complete" : "error",
          errorMessage: String(row[0]).startsWith("Alpha") ? "" : "429 Too Many Requests",
        }));
        return callback({ results: rows, outcomes });
      }
      if (payload?.action === "translateSingleTextDetailed") {
        return callback({ result: "", outcome: { status: "complete" } });
      }
      callback(undefined);
    });

    pageTranslator.translatePage("fr");

    await vi.waitFor(() => {
      const proxies = getAllProxies();
      expect(proxies.some((p) => p.googleBtnState === "success")).toBe(true);
      expect(proxies.some((p) => p.googleBtnState === "error")).toBe(true);
    }, { timeout: 5000 });

    const successState = getAllProxies().find((p) => p.googleBtnState === "success");
    const failedState = getAllProxies().find((p) => p.googleBtnState === "error");
    expect(successState.googleSpan.textContent).toContain("FR:Alpha");
    expect(failedState.googleSpan.textContent).toBe("");
    expect(t1.textContent).toContain("Alpha paragraph");
    expect(t2.textContent).toBe("Beta paragraph that google refused");
  });

  it("single-text surfaces reject on an engine failure instead of resolving \"\" (plan 118 / P3)", async () => {
    sendMessageMock.mockImplementation((payload, callback) => {
      if (payload?.action === "translateSingleTextDetailed") {
        callback({ result: "", outcome: { status: "error", errorMessage: "429 Too Many Requests" } });
        return;
      }
      callback(undefined);
    });

    await expect(
      backgroundTranslateSingleText("google", "fr", "hello")
    ).rejects.toThrow("429 Too Many Requests");
  });

  it("single-text legacy string responses still resolve (SW compatibility)", async () => {
    sendMessageMock.mockImplementation((payload, callback) => {
      if (payload?.action === "translateSingleTextDetailed") {
        callback("Bonjour");
        return;
      }
      callback(undefined);
    });

    await expect(
      backgroundTranslateSingleText("google", "fr", "hello")
    ).resolves.toBe("Bonjour");
  });

  it("attribute failure leaves the site's original value untouched (plan 118 / P3)", () => {
    const okNode = document.createElement("div");
    okNode.setAttribute("title", "Alpha attribute text");
    document.body.appendChild(okNode);
    const failedNode = document.createElement("div");
    failedNode.setAttribute("title", "Beta attribute text");
    document.body.appendChild(failedNode);

    const attrs = [
      { node: okNode, attrName: "title", original: "Alpha attribute text", isTranslated: true },
      { node: failedNode, attrName: "title", original: "Beta attribute text", isTranslated: true },
    ];

    const failures = pageTranslator._translateAttributes(
      attrs,
      ["FR Alpha attribute text", ""],
      [
        { status: "complete" },
        { status: "error", errorMessage: "429 Too Many Requests" },
      ]
    );

    expect(okNode.getAttribute("title")).toBe("FR Alpha attribute text");
    expect(failedNode.getAttribute("title")).toBe("Beta attribute text");
    expect(failures).toHaveLength(1);
    expect(failures[0].errorText).toContain("429");
  });
});
