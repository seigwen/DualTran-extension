/**
 * SPEC 2.1 #5 — primary AI entry gate.
 *
 * When no AI provider is configured (`aiProvider === ""`) the primary
 * "translate with AI" entry must be DISABLED and carry the localized
 * `providerRequiredError` as its tooltip/title, and `translatePageAi` must
 * refuse without starting a flow. A disabled control cannot be clicked, so
 * this is the user-visible half of "zero network requests"; the request-path
 * half is pinned by the aiTranslateText / fetchSSE cases.
 *
 * Lives in its own file because the pageTranslator API is assigned inside the
 * module's `twpConfig.onReady()` promise chain: the import needs a resolved
 * onReady (see pageTranslator.aiContinuousMode.integration.test.js for the
 * same lifecycle pattern).
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { translateWithAIMock, configValues } = vi.hoisted(() => ({
  translateWithAIMock: vi.fn(),
  configValues: {
    autoImproveByAI: "no",
    aiProvider: "openai",
    providerConfigs: {},
    targetLanguage: "fr",
    aiTranslatedColor: "rgb(1, 2, 3)",
    enableAiTranslationCache: "no",
    alwaysTranslateSites: [],
    neverTranslateSites: [],
    neverTranslateLangs: [],
    alwaysTranslateLangs: [],
    alwaysTranslateLangsAI: [],
    alwaysTranslateSitesAI: [],
    targetLanguageTextTranslation: "",
    apiKeyOpenAI: "test-api-key",
  },
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
    codeToLanguageNameInEnglish: vi.fn((c) => c),
    fixTLanguageCode: vi.fn((c) => c),
  },
}));

vi.mock("../../src/lib/platformInfo.js", () => ({ default: {} }));
vi.mock("../../src/contentScript/showOriginal.js", () => ({
  default: { enable: vi.fn(), disable: vi.fn(), enabledObserverSubscribe: vi.fn(), isEnabled: false },
}));
// mock-fidelity-allow: this file asserts the no-request guard; the transport is deliberately a spy (arrival semantics pinned elsewhere)
vi.mock("../../src/contentScript/fetchSSE.js", () => ({
  translateWithAI: translateWithAIMock,
}));
// mock-fidelity-allow: arrival parsing is not exercised here (the entry gate is the subject)
vi.mock("../../src/contentScript/aiStreamMessage.js", () => ({
  notifyAiStreamParseError: vi.fn(),
  parseOpenAiStyleStreamMessage: vi.fn(() => ({ type: "done" })),
  parseTaggedPageTranslationProgress: vi.fn(() => ({ done: true })),
}));
vi.mock("../../src/contentScript/aiUiState.js", () => ({
  applyAiErrorState: vi.fn(),
  applyAiSuccessState: vi.fn(),
  applyAiTranslatingState: vi.fn(),
  ERROR_CROSS_COLOR: "#ff0000",
  formatAiTranslationError: vi.fn((e) => e?.message || "error"),
  renderAiErrorIndicator: vi.fn(),
}));
vi.mock("../../src/contentScript/i18n.js", () => ({
  getMessageWithFallback: vi.fn((key, fallback) => fallback),
  getAiImproveTranslationTooltipText: vi.fn(() => ""),
}));
vi.mock("toastify-js", () => ({ default: vi.fn(() => ({ showToast: vi.fn() })) }));
vi.mock("gpt-tokenizer", () => ({ encode: vi.fn(() => []) }));
vi.mock("../../src/contentScript/singletonBtnGroup.js", () => ({
  registerBlock: vi.fn(),
  createSingletonButtonGroup: vi.fn(),
  destroySingletonButtonGroup: vi.fn(),
  attachHoverDelegation: vi.fn(),
  hideButtonGroup: vi.fn(),
  setEntryPolicyProvider: vi.fn(),
  syncBlockBadges: vi.fn(),
  syncAllBlockBadgeActiveStates: vi.fn(),
  setCallbacks: vi.fn(),
  getProxiesForTranslation: vi.fn(() => []),
  getAllProxies: vi.fn(() => []),
  updateSingletonUI: vi.fn(),
  getBlockState: vi.fn(() => null),
}));
vi.mock("../../src/lib/ai/providerRegistry.js", () => ({
  createProviderRegistry: () => ({ getProvider: () => null, listProviders: () => [] }),
  BUILT_IN_PROVIDERS: [],
}));

const PROVIDER_REQUIRED = "Choose an AI provider in settings before translating.";

let pageTranslator;

beforeAll(async () => {
  vi.stubGlobal("top", window);
  vi.stubGlobal("self", window);
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ text: () => Promise.resolve(""), ok: true })));
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: vi.fn((payload, callback) => {
        if (typeof callback === "function") {
          callback(payload?.action === "getTabHostName" ? "example.com" : undefined);
        }
      }),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      getURL: (path) => `chrome-extension://test/${path}`,
    },
    storage: {
      local: { get: vi.fn(() => Promise.resolve({})), set: vi.fn(() => Promise.resolve()) },
      onChanged: { addListener: vi.fn() },
    },
    i18n: { getMessage: vi.fn(() => "") },
  });
  globalThis.alert = vi.fn();
  globalThis.prompt = vi.fn();
  globalThis.confirm = vi.fn(() => false);

  const mod = await import("../../src/contentScript/pageTranslator.js");
  pageTranslator = mod.pageTranslator;
  await vi.waitFor(() => {
    expect(pageTranslator.translatePageAi).toBeTypeOf("function");
  }, { timeout: 5000 });
});

beforeEach(() => {
  translateWithAIMock.mockReset();
  globalThis.confirm.mockClear();
  configValues.aiProvider = "openai";
  configValues.apiKeyOpenAI = "test-api-key";
  document.body.innerHTML = "";
});

describe("pageTranslator translatePageAi — primary button gate (SPEC 2.1 #5)", () => {
  it("disables the primary AI entry and titles it with providerRequiredError when no provider is configured", () => {
    configValues.aiProvider = "";

    // #btnAi is the real primary AI entry of the floating button group.
    const btn = document.createElement("button");
    btn.id = "btnAi";
    document.body.appendChild(btn);

    const started = pageTranslator.translatePageAi();

    expect(started).toBe(false);
    expect(translateWithAIMock).not.toHaveBeenCalled();
    // User-visible affordance: disabled + the same localized string as tooltip.
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe(PROVIDER_REQUIRED);
    // No "set an API key" detour: the provider itself is missing.
    expect(globalThis.confirm).not.toHaveBeenCalled();
  });

  it("keeps the primary AI entry enabled once a provider is configured", () => {
    const btn = document.createElement("button");
    btn.id = "btnAi";
    document.body.appendChild(btn);

    // Prime the disabled state first so the negative case proves the re-enable.
    configValues.aiProvider = "";
    pageTranslator.translatePageAi();
    expect(btn.disabled).toBe(true);

    configValues.aiProvider = "openai";
    configValues.apiKeyOpenAI = "test-api-key";
    pageTranslator.translatePageAi();

    expect(btn.disabled).toBe(false);
    expect(btn.title).toBe("");
  });
});
