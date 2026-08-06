import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let _moduleLoadSeq = 0; // 确定性 cache-busting（替代 Math.random()）

const SOURCE_FILE_URL = new URL("../../src/background/translationService.js", import.meta.url);

const mockState = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  translationCacheGetMock: vi.fn(),
  translationCacheSetMock: vi.fn(),
  getAlternativeServiceMock: vi.fn(),
  codeToGoogleLanguageMock: vi.fn(),
  isLanguageCodeValidMock: vi.fn(),
  fixTLanguageCodeMock: vi.fn(),
  codeToLanguageMock: vi.fn(),
  xhrQueue: [],
  xhrRequests: [],
  runtimeOnMessageListeners: [],
  runtimeLastErrorValue: undefined,
  chromeLastErrorGetter: vi.fn(),
  tabsGetMock: vi.fn(),
  tabsSendMessageMock: vi.fn(),
  tabsCreateMock: vi.fn(),
}));

vi.mock("../../src/lib/languages.js", () => ({
  default: {
    getAlternativeService: (...args) => mockState.getAlternativeServiceMock(...args),
    codeToGoogleLanguage: (...args) => mockState.codeToGoogleLanguageMock(...args),
    isLanguageCodeValid: (...args) => mockState.isLanguageCodeValidMock(...args),
    fixTLanguageCode: (...args) => mockState.fixTLanguageCodeMock(...args),
    codeToLanguage: (...args) => mockState.codeToLanguageMock(...args),
    languageList: {},
    alternativeServices: {},
    otherConfigs: {},
  },
}));

vi.mock("../../src/background/translationCache.js", () => ({
  default: {
    get: (...args) => mockState.translationCacheGetMock(...args),
    set: (...args) => mockState.translationCacheSetMock(...args),
  },
}));

class MockXMLHttpRequest {
  constructor() {
    this.method = null;
    this.url = null;
    this.body = null;
    this.status = 200;
    this.statusText = "OK";
    this.responseText = "";
    this.timeout = 0;
    this.onload = null;
    this.onerror = null;
    this.onabort = null;
    this.ontimeout = null;
    mockState.xhrRequests.push(this);
  }

  open(method, url) {
    this.method = method;
    this.url = url;
  }

  send(body) {
    this.body = body;
    const plan = mockState.xhrQueue.shift();

    if (!plan) {
      throw new Error(`Missing XMLHttpRequest mock for ${this.method} ${this.url}`);
    }

    if (typeof plan.assert === "function") {
      plan.assert(this);
    }

    setTimeout(() => {
      this.status = plan.status ?? 200;
      this.statusText = plan.statusText ?? "OK";
      this.responseText = plan.responseText ?? "";

      if (plan.type === "error") {
        this.onerror?.(plan.error ?? new Error("XMLHttpRequest error"));
      } else if (plan.type === "abort") {
        this.onabort?.(plan.error ?? new Error("XMLHttpRequest aborted"));
      } else if (plan.type === "timeout") {
        this.ontimeout?.(plan.error ?? new Error("XMLHttpRequest timeout"));
      } else {
        this.onload?.({ target: this });
      }
    }, 0);
  }
}

function createFetchResponse(body, init = {}) {
  const textBody = typeof body === "string" ? body : JSON.stringify(body);
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? (status >= 200 && status < 300),
    status,
    statusText: init.statusText ?? "OK",
    text: vi.fn().mockResolvedValue(textBody),
    json: vi.fn().mockResolvedValue(typeof body === "string" ? JSON.parse(body) : body),
  };
}

function queueXhrLoad(responseText, extra = {}) {
  mockState.xhrQueue.push({ type: "load", responseText, ...extra });
}

function flushTimers() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeJwt(expSecondsFromNow = 3600) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow })
  ).toString("base64url");
  return `${header}.${payload}.signature`;
}

function resetMockState() {
  mockState.fetchMock.mockReset();
  mockState.translationCacheGetMock.mockReset().mockResolvedValue(undefined);
  mockState.translationCacheSetMock.mockReset().mockResolvedValue(true);
  mockState.getAlternativeServiceMock.mockReset().mockImplementation((_, serviceName) => serviceName);
  mockState.codeToGoogleLanguageMock.mockReset().mockImplementation((code) => code);
  mockState.isLanguageCodeValidMock.mockReset().mockImplementation((code) => Boolean(code));
  mockState.fixTLanguageCodeMock.mockReset().mockImplementation((code) => code);
  mockState.codeToLanguageMock.mockReset().mockImplementation((code) => code);
  mockState.chromeLastErrorGetter.mockReset();
  mockState.tabsGetMock.mockReset();
  mockState.tabsSendMessageMock.mockReset();
  mockState.tabsCreateMock.mockReset();
  mockState.xhrQueue.length = 0;
  mockState.xhrRequests.length = 0;
  mockState.runtimeOnMessageListeners.length = 0;
  mockState.runtimeLastErrorValue = undefined;
}

function installChromeMock() {
  globalThis.chrome = {
    runtime: {
      id: "test-extension",
      sendMessage: vi.fn(),
      onMessage: {
        addListener: vi.fn((listener) => {
          mockState.runtimeOnMessageListeners.push(listener);
        }),
        removeListener: vi.fn((listener) => {
          const index = mockState.runtimeOnMessageListeners.indexOf(listener);
          if (index >= 0) mockState.runtimeOnMessageListeners.splice(index, 1);
        }),
      },
      get lastError() {
        mockState.chromeLastErrorGetter();
        return mockState.runtimeLastErrorValue;
      },
    },
    i18n: {
      getMessage: vi.fn((key) => key),
    },
    tabs: {
      get: mockState.tabsGetMock,
      sendMessage: mockState.tabsSendMessageMock,
      create: mockState.tabsCreateMock,
    },
  };
}

async function importActualTranslationService() {
  const module = await import("../../src/background/translationService.js");
  return module.default;
}

async function importTestableTranslationService() {
  const source = await readFile(SOURCE_FILE_URL, "utf8");
  const instrumentedSource = source
    .replace(
      /import twpLang from "\.\.\/lib\/languages\.js"\s*/,
      'const twpLang = globalThis.__translationServiceTestDeps.twpLang;\n'
    )
    .replace(
      /import translationCache from "\.\.\/background\/translationCache\.js"\s*/,
      'const translationCache = globalThis.__translationServiceTestDeps.translationCache;\n'
    )
    .replace(
      /return translationService;\s*\}\)\(\);/,
      [
        "translationService.__testHooks = {",
        "  checkedLastError,",
        "  Utils,",
        "  YandexHelper,",
        "  BingHelper,",
        "  MicrosoftEdgeHelper,",
        "  Service,",
        "  serviceList,",
        "  googleService,",
        "  yandexService,",
        "  bingService,",
        "  deeplService,",
        "  microsoftService,",
        "};",
        "  return translationService;",
        "})();",
      ].join("\n")
    )
    .concat(`\n//# sourceURL=translationService.testable.${_moduleLoadSeq++}.js`);

  globalThis.__translationServiceTestDeps = {
    twpLang: {
      getAlternativeService: (...args) => mockState.getAlternativeServiceMock(...args),
      codeToGoogleLanguage: (...args) => mockState.codeToGoogleLanguageMock(...args),
      isLanguageCodeValid: (...args) => mockState.isLanguageCodeValidMock(...args),
      fixTLanguageCode: (...args) => mockState.fixTLanguageCodeMock(...args),
      codeToLanguage: (...args) => mockState.codeToLanguageMock(...args),
      languageList: {},
      alternativeServices: {},
      otherConfigs: {},
    },
    translationCache: {
      get: (...args) => mockState.translationCacheGetMock(...args),
      set: (...args) => mockState.translationCacheSetMock(...args),
    },
  };

  const moduleUrl = `data:text/javascript;base64,${Buffer.from(instrumentedSource).toString("base64")}`;
  const module = await import(moduleUrl);
  return module.default;
}

describe("translationService", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    resetMockState();
    installChromeMock();
    globalThis.fetch = mockState.fetchMock;
    globalThis.XMLHttpRequest = MockXMLHttpRequest;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete globalThis.browser;
  });

  afterEach(() => {
    delete globalThis.chrome;
    delete globalThis.fetch;
    delete globalThis.XMLHttpRequest;
    delete globalThis.__translationServiceTestDeps;
    delete globalThis.browser;
    vi.useRealTimers();
  });

  describe("internal helpers and Service base class", () => {
    it("escapes HTML-sensitive characters", async () => {
      const translationService = await importTestableTranslationService();
      const { Utils } = translationService.__testHooks;

      expect(Utils.escapeHTML(`A & <tag> \"quote\" 'single'`)).toBe(
        "A &amp; &lt;tag&gt; &quot;quote&quot; &#39;single&#39;"
      );
    });

    it("unescapes HTML entities back to plain text", async () => {
      const translationService = await importTestableTranslationService();
      const { Utils } = translationService.__testHooks;

      expect(
        Utils.unescapeHTML("A &amp; &lt;tag&gt; &quot;quote&quot; &#39;single&#39;")
      ).toBe(`A & <tag> \"quote\" 'single'`);
    });

    it("checkedLastError reads chrome.runtime.lastError without throwing", async () => {
      const translationService = await importTestableTranslationService();
      const { checkedLastError } = translationService.__testHooks;

      mockState.runtimeLastErrorValue = new Error("receiving end does not exist");

      expect(() => checkedLastError()).not.toThrow();
      expect(mockState.chromeLastErrorGetter).toHaveBeenCalledOnce();
    });

    it("fixString replaces zero-width spaces with normal spaces", async () => {
      const translationService = await importTestableTranslationService();
      const { Service } = translationService.__testHooks;
      const service = new Service(
        "custom",
        "https://service.test",
        "GET",
        (sourceArray) => sourceArray.join("|"),
        () => [],
        (result) => (result ? result.split("|") : [""])
      );

      expect(service.fixString("alpha\u200bbeta\u200bgamma")).toBe("alpha beta gamma");
    });

    it("removeTranslationsWithError only prunes errored in-memory entries", async () => {
      const translationService = await importTestableTranslationService();
      const { Service } = translationService.__testHooks;
      const service = new Service(
        "custom",
        "https://service.test",
        "GET",
        (sourceArray) => sourceArray.join("|"),
        () => [],
        (result) => (result ? result.split("|") : [""])
      );

      service.translationsInProgress.set("keep", { status: "complete" });
      service.translationsInProgress.set("drop", { status: "error" });

      service.removeTranslationsWithError();

      expect([...service.translationsInProgress.keys()]).toEqual(["keep"]);
    });

    it("getRequests reuses cached entries and batches uncached work", async () => {
      const translationService = await importTestableTranslationService();
      const { Service } = translationService.__testHooks;
      const service = new Service(
        "custom",
        "https://service.test",
        "GET",
        (sourceArray) => sourceArray.join("|"),
        () => [],
        (result) => (result ? result.split("|") : [""])
      );

      mockState.translationCacheGetMock
        .mockResolvedValueOnce({ translatedText: "cached-result", detectedLanguage: "en" })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      const [requests, progress] = await service.getRequests("en", "fr", [
        ["cached"],
        ["x".repeat(810)],
        ["fresh"],
      ]);

      expect(mockState.translationCacheGetMock).toHaveBeenCalledTimes(3);
      expect(progress[0].status).toBe("complete");
      expect(progress[0].translatedText).toBe("cached-result");
      expect(requests).toHaveLength(2);
      expect(requests[0]).toHaveLength(1);
      expect(requests[1]).toHaveLength(1);
      expect(requests[0][0].originalText).toBe("x".repeat(810));
      expect(requests[1][0].originalText).toBe("fresh");
    });

    it("translate falls back to empty strings when parsed responses are invalid", async () => {
      const translationService = await importTestableTranslationService();
      const { Service } = translationService.__testHooks;
      const service = new Service(
        "custom",
        "https://service.test",
        "GET",
        (sourceArray) => sourceArray.join("|"),
        () => [],
        (result) => (result ? result.split("|") : [""])
      );

      mockState.fetchMock.mockResolvedValueOnce(createFetchResponse({ ok: true }));

      const result = await service.translate("en", "fr", [["hello"]]);

      expect(result).toEqual([[""]]);
      expect(mockState.translationCacheSetMock).not.toHaveBeenCalled();
    });
  });

  describe("public API and concrete services", () => {
    it("google translateSingleText builds the expected URL, parses the response, and caches it", async () => {
      const translationService = await importActualTranslationService();
      mockState.fetchMock.mockResolvedValueOnce(
        createFetchResponse([[['Bonjour &lt;b&gt;Monde&lt;/b&gt; &amp; &quot;amis&quot;']], null, "en"])
      );

      const result = await translationService.translateSingleText(
        "google",
        "en",
        "fr",
        'Hello <b>World</b> & "friends"'
      );

      expect(result).toBe('Bonjour <b>Monde</b> & "amis"');
      expect(mockState.fetchMock).toHaveBeenCalledOnce();
      const [url] = mockState.fetchMock.mock.calls[0];
      const parsedUrl = new URL(url);
      expect(parsedUrl.origin).toBe("https://translate.googleapis.com");
      expect(parsedUrl.searchParams.get("client")).toBe("gtx");
      expect(parsedUrl.searchParams.get("sl")).toBe("en");
      expect(parsedUrl.searchParams.get("tl")).toBe("fr");
      expect(parsedUrl.searchParams.get("q")).toBe(
        "Hello &lt;b&gt;World&lt;/b&gt; &amp; &quot;friends&quot;"
      );
      expect(mockState.translationCacheGetMock).toHaveBeenCalledWith(
        "google",
        "en",
        "fr",
        "Hello &lt;b&gt;World&lt;/b&gt; &amp; &quot;friends&quot;"
      );
      expect(mockState.translationCacheSetMock).toHaveBeenCalledWith(
        "google",
        "en",
        "fr",
        "Hello &lt;b&gt;World&lt;/b&gt; &amp; &quot;friends&quot;",
        "Bonjour &lt;b&gt;Monde&lt;/b&gt; &amp; &quot;amis&quot;",
        "en"
      );
    });

    it("translateHTML uses the HTML path and preserves nested google results", async () => {
      const translationService = await importActualTranslationService();
      mockState.fetchMock
        .mockResolvedValueOnce(createFetchResponse([[['Uno\n\n\nDos']], null, "en"]))
        .mockResolvedValueOnce(createFetchResponse([[['Tres']], null, "en"]));

      const result = await translationService.translateHTML("google", "en", "es", [
        ["One", "Two"],
        ["Three"],
      ]);

      expect(result).toEqual([
        ["Uno", "Dos"],
        ["Tres"],
      ]);
      expect(mockState.getAlternativeServiceMock).toHaveBeenCalledWith("es", "google", true);
    });

    it("translateText dispatches to the selected alternative service and returns bing output", async () => {
      mockState.getAlternativeServiceMock.mockImplementation((_, __, isHtml) =>
        isHtml ? "google" : "bing"
      );
      queueXhrLoad(
        [
          'params_RichTranslateHelper = [123456,"bing-token-value-which-is-long-enough"]',
          'data-iid="translator.5020"',
          'IG:"IGVALUE"',
        ].join(" some filler content ")
      );
      mockState.fetchMock.mockResolvedValueOnce(
        createFetchResponse([
          {
            translations: [{ text: "kumusta" }],
            detectedLanguage: { language: "en" },
          },
        ])
      );
      const translationService = await importActualTranslationService();

      const result = await translationService.translateText("google", "auto", "tl", ["hello"]);

      await flushTimers();

      expect(result).toEqual(["kumusta"]);
      expect(mockState.getAlternativeServiceMock).toHaveBeenCalledWith("tl", "google", false);
      expect(mockState.fetchMock).toHaveBeenCalledOnce();
      const [url, options] = mockState.fetchMock.mock.calls[0];
      expect(url).toContain("https://www.bing.com/ttranslatev3?isVertical=1&IG=IGVALUE&IID=translator.5020");
      expect(options.method).toBe("POST");
      expect(options.body).toContain("fromLang=auto-detect");
      expect(options.body).toContain("to=fil");
      expect(options.body).toContain("&token=bing-token-value-which-is-long-enough&key=123456");
    });

    it("yandex translateSingleText fetches a SID and normalizes zh language codes", async () => {
      queueXhrLoad("window.foo = 1; sid: 'deadbeef.123456'; window.bar = 2;");
      mockState.fetchMock.mockResolvedValueOnce(
        createFetchResponse({ lang: "zh-en", text: ["hello"] })
      );
      const translationService = await importActualTranslationService();

      const result = await translationService.translateSingleText("yandex", "zh-CN", "en", "你好");

      await flushTimers();

      expect(result).toBe("hello");
      expect(mockState.xhrRequests).toHaveLength(1);
      expect(mockState.xhrRequests[0].url).toContain("translate.yandex.net/website-widget");
      const [url] = mockState.fetchMock.mock.calls[0];
      expect(url).toContain("id=deadbeef.123456-0-0");
      expect(url).toContain("lang=zh-en");
      expect(url).toContain("text=%E4%BD%A0%E5%A5%BD");
    });

    it("bing translateSingleText maps zh variants to Microsoft language codes", async () => {
      queueXhrLoad(
        [
          'params_RichTranslateHelper = [445566,"mapped-token-value-which-is-long-enough"]',
          'data-iid="translator.6001"',
          'IG:"ALTIG"',
        ].join(" some filler content ")
      );
      mockState.fetchMock.mockResolvedValueOnce(
        createFetchResponse([
          {
            translations: [{ text: "您好" }],
            detectedLanguage: { language: "zh-Hans" },
          },
        ])
      );
      const translationService = await importActualTranslationService();

      const result = await translationService.translateSingleText("bing", "zh-CN", "zh-TW", "你好");

      await flushTimers();

      expect(result).toBe("您好");
      const [, options] = mockState.fetchMock.mock.calls[0];
      expect(options.body).toContain("fromLang=zh-Hans");
      expect(options.body).toContain("to=zh-Hant");
    });

    it("deepl reuses an existing tab and returns the callback result", async () => {
      const translationService = await importTestableTranslationService();
      translationService.__testHooks.deeplService.DeepLTab = { id: 99 };
      mockState.runtimeLastErrorValue = new Error("ignored");
      mockState.tabsGetMock.mockImplementation((tabId, callback) => {
        callback({ id: tabId });
      });
      mockState.tabsSendMessageMock.mockImplementation((tabId, message, options, callback) => {
        callback("bonjour");
      });

      const result = await translationService.translateSingleText("deepl", "en", "fr", "hello");

      expect(result).toBe("bonjour");
      expect(mockState.tabsGetMock).toHaveBeenCalledWith(99, expect.any(Function));
      expect(mockState.tabsSendMessageMock).toHaveBeenCalledWith(
        99,
        {
          action: "translateTextWithDeepL",
          text: "hello",
          targetLanguage: "fr",
        },
        { frameId: 0 },
        expect.any(Function)
      );
      expect(mockState.chromeLastErrorGetter).toHaveBeenCalledOnce();
    });

    it("deepl opens a new tab and resolves from the first runtime message", async () => {
      const translationService = await importTestableTranslationService();
      mockState.tabsCreateMock.mockImplementation((details, callback) => {
        callback({ id: 55, url: details.url });
      });

      const pending = translationService.translateSingleText("deepl", "en", "fr", "hello world");
      await flushTimers();

      expect(mockState.tabsCreateMock).toHaveBeenCalledOnce();
      expect(mockState.tabsCreateMock.mock.calls[0][0].url).toBe(
        "https://www.deepl.com/#!fr!#hello%20world"
      );
      expect(mockState.runtimeOnMessageListeners).toHaveLength(2);

      const deeplListener = mockState.runtimeOnMessageListeners.at(-1);
      deeplListener({ action: "DeepL_firstTranslationResult", result: "salut" }, {}, vi.fn());

      await expect(pending).resolves.toBe("salut");
    });

    it("returns cached google translations without hitting fetch", async () => {
      mockState.translationCacheGetMock.mockResolvedValueOnce({
        translatedText: "Bonjour &lt;i&gt;monde&lt;/i&gt;",
        detectedLanguage: "en",
      });
      const translationService = await importActualTranslationService();

      const result = await translationService.translateSingleText(
        "google",
        "en",
        "fr",
        "Hello <i>world</i>"
      );

      expect(result).toBe("Bonjour <i>monde</i>");
      expect(mockState.fetchMock).not.toHaveBeenCalled();
      expect(mockState.translationCacheSetMock).not.toHaveBeenCalled();
    });

    it("returns an empty string when a google request fails", async () => {
      mockState.fetchMock.mockRejectedValueOnce(new Error("network down"));
      const translationService = await importActualTranslationService();

      const result = await translationService.translateSingleText("google", "en", "fr", "hello");

      expect(result).toBe("");
      expect(mockState.translationCacheSetMock).not.toHaveBeenCalled();
    });

    it("returns an empty string for empty google translations and does not cache them", async () => {
      mockState.fetchMock.mockResolvedValueOnce(createFetchResponse([[['']], null, "en"]));
      const translationService = await importActualTranslationService();

      const result = await translationService.translateSingleText("google", "en", "fr", "");

      expect(result).toBe("");
      expect(mockState.translationCacheSetMock).not.toHaveBeenCalled();
    });

    it("deduplicates concurrent identical google requests", async () => {
      let resolveFetch;
      mockState.fetchMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFetch = () => resolve(createFetchResponse([[['bonjour']], null, "en"]));
          })
      );
      const translationService = await importActualTranslationService();

      const first = translationService.translateSingleText("google", "en", "fr", "hello");
      const second = translationService.translateSingleText("google", "en", "fr", "hello");

      await flushTimers();

      expect(mockState.fetchMock).toHaveBeenCalledTimes(1);
      expect(resolveFetch).toEqual(expect.any(Function));

      resolveFetch();

      await expect(Promise.all([first, second])).resolves.toEqual(["bonjour", "bonjour"]);
      expect(mockState.translationCacheSetMock).toHaveBeenCalledOnce();
    });

    it("falls back to google when the requested service is unknown", async () => {
      mockState.fetchMock.mockResolvedValueOnce(createFetchResponse([[['bonjour']], null, "en"]));
      const translationService = await importActualTranslationService();

      const result = await translationService.translateSingleText("unknown-service", "en", "fr", "hello");

      expect(result).toBe("bonjour");
      const [url] = mockState.fetchMock.mock.calls[0];
      expect(url).toContain("translate.googleapis.com/translate_a/single");
    });

    it("MicrosoftEdgeHelper fetches and caches a valid token", async () => {
      const translationService = await importTestableTranslationService();
      const { MicrosoftEdgeHelper } = translationService.__testHooks;
      const token = makeJwt();
      queueXhrLoad(token);

      await expect(MicrosoftEdgeHelper.getToken()).resolves.toBe(token);
      await flushTimers();
      await expect(MicrosoftEdgeHelper.getToken()).resolves.toBe(token);

      expect(mockState.xhrRequests).toHaveLength(1);
      expect(mockState.xhrRequests[0].url).toBe("https://edge.microsoft.com/translate/auth");
    });

    it("MicrosoftEdgeHelper falls back to a synthetic expiry when token parsing fails", async () => {
      const translationService = await importTestableTranslationService();
      const { MicrosoftEdgeHelper } = translationService.__testHooks;
      queueXhrLoad("not-a-jwt-token");

      await expect(MicrosoftEdgeHelper.getToken()).resolves.toBe("not-a-jwt-token");
      await flushTimers();
      await expect(MicrosoftEdgeHelper.getToken()).resolves.toBe("not-a-jwt-token");

      expect(mockState.xhrRequests).toHaveLength(1);
    });

    it("MicrosoftEdgeHelper resolves null when token fetch fails", async () => {
      const translationService = await importTestableTranslationService();
      const { MicrosoftEdgeHelper } = translationService.__testHooks;
      mockState.xhrQueue.push({ type: "error" });

      await expect(MicrosoftEdgeHelper.getToken()).resolves.toBeNull();
      await flushTimers();
    });

    it("maps Microsoft language codes and builds request headers", async () => {
      const translationService = await importTestableTranslationService();
      const { MicrosoftEdgeHelper, microsoftService } = translationService.__testHooks;

      expect(MicrosoftEdgeHelper.mapLanguageCode("auto")).toBe("");
      expect(MicrosoftEdgeHelper.mapLanguageCode("zh-CN")).toBe("zh-Hans");
      expect(MicrosoftEdgeHelper.mapLanguageCode("tl")).toBe("fil");
      expect(MicrosoftEdgeHelper.mapLanguageCode("fr")).toBe("fr");
      expect(microsoftService.buildRequestHeaders("token-123")).toEqual(
        expect.objectContaining({
          Accept: "*/*",
          Authorization: "Bearer token-123",
          "Content-Type": "application/json",
        })
      );
    });

    it("microsoft translate succeeds, maps languages, and caches results", async () => {
      const translationService = await importTestableTranslationService();
      const { microsoftService } = translationService.__testHooks;
      queueXhrLoad(makeJwt());
      mockState.fetchMock.mockResolvedValueOnce(
        createFetchResponse([
          {
            translations: [{ text: "您好" }],
            detectedLanguage: { language: "zh-Hans" },
          },
        ])
      );

      const result = await microsoftService.translate("zh-CN", "zh-TW", [["你好"]]);

      expect(result).toEqual([["您好"]]);
      expect(mockState.fetchMock).toHaveBeenCalledOnce();
      const [url, options] = mockState.fetchMock.mock.calls[0];
      expect(url).toContain("to=zh-Hant");
      expect(url).toContain("from=zh-Hans");
      expect(options.headers.Authorization).toMatch(/^Bearer /);
      expect(options.body).toBe(JSON.stringify([{ text: "你好" }]));
      expect(mockState.translationCacheSetMock).toHaveBeenCalledWith(
        "microsoft",
        "zh-CN",
        "zh-TW",
        "你好",
        "您好",
        "zh-Hans"
      );
    });

    it("microsoft falls back to bing when token is unavailable", async () => {
      const translationService = await importTestableTranslationService();
      const { microsoftService } = translationService.__testHooks;
      mockState.xhrQueue.push({ type: "error" });
      queueXhrLoad(
        [
          'params_RichTranslateHelper = [123456,"bing-token-value-which-is-long-enough"]',
          'data-iid="translator.5020"',
          'IG:"IGVALUE"',
        ].join(" some filler content ")
      );
      mockState.fetchMock.mockResolvedValueOnce(
        createFetchResponse([
          {
            translations: [{ text: "bonjour" }],
            detectedLanguage: { language: "en" },
          },
        ])
      );

      await expect(microsoftService.translate("en", "fr", [["hello"]])).resolves.toEqual([["bonjour"]]);
      expect(mockState.fetchMock).toHaveBeenCalledOnce();
    });

    it("microsoft falls back to bing on HTTP error", async () => {
      const translationService = await importTestableTranslationService();
      const { microsoftService } = translationService.__testHooks;
      queueXhrLoad(makeJwt());
      queueXhrLoad(
        [
          'params_RichTranslateHelper = [123456,"bing-token-value-which-is-long-enough"]',
          'data-iid="translator.5020"',
          'IG:"IGVALUE"',
        ].join(" some filler content ")
      );
      mockState.fetchMock
        .mockResolvedValueOnce(createFetchResponse({ error: { message: "bad" } }, { status: 503, ok: false }))
        .mockResolvedValueOnce(
          createFetchResponse([
            {
              translations: [{ text: "fallback-http" }],
              detectedLanguage: { language: "en" },
            },
          ])
        );

      await expect(microsoftService.translate("en", "fr", [["hello"]])).resolves.toEqual([["fallback-http"]]);
      expect(mockState.fetchMock).toHaveBeenCalledTimes(2);
    });

    it("microsoft falls back to bing on malformed response", async () => {
      const translationService = await importTestableTranslationService();
      const { microsoftService } = translationService.__testHooks;
      queueXhrLoad(makeJwt());
      queueXhrLoad(
        [
          'params_RichTranslateHelper = [123456,"bing-token-value-which-is-long-enough"]',
          'data-iid="translator.5020"',
          'IG:"IGVALUE"',
        ].join(" some filler content ")
      );
      mockState.fetchMock
        .mockResolvedValueOnce(createFetchResponse([{ translations: [{ text: "" }] }]))
        .mockResolvedValueOnce(
          createFetchResponse([
            {
              translations: [{ text: "fallback-malformed" }],
              detectedLanguage: { language: "en" },
            },
          ])
        );

      await expect(microsoftService.translate("en", "fr", [["hello"]])).resolves.toEqual([
        ["fallback-malformed"],
      ]);
    });

    it("microsoft falls back to bing on network error", async () => {
      const translationService = await importTestableTranslationService();
      const { microsoftService } = translationService.__testHooks;
      queueXhrLoad(makeJwt());
      queueXhrLoad(
        [
          'params_RichTranslateHelper = [123456,"bing-token-value-which-is-long-enough"]',
          'data-iid="translator.5020"',
          'IG:"IGVALUE"',
        ].join(" some filler content ")
      );
      mockState.fetchMock
        .mockRejectedValueOnce(new Error("socket hang up"))
        .mockResolvedValueOnce(
          createFetchResponse([
            {
              translations: [{ text: "fallback-network" }],
              detectedLanguage: { language: "en" },
            },
          ])
        );

      await expect(microsoftService.translate("en", "fr", [["hello"]])).resolves.toEqual([
        ["fallback-network"],
      ]);
    });

    it("microsoft removeTranslationsWithError prunes errored entries", async () => {
      const translationService = await importTestableTranslationService();
      const { microsoftService } = translationService.__testHooks;

      microsoftService.translationsInProgress.set("keep", { status: "complete" });
      microsoftService.translationsInProgress.set("drop", { status: "error" });
      microsoftService.removeTranslationsWithError();

      expect([...microsoftService.translationsInProgress.keys()]).toEqual(["keep"]);
    });
  });

  describe("runtime message handlers", () => {
    it("handles translateHTML messages and returns async results", async () => {
      const translationService = await importActualTranslationService();
      const listener = mockState.runtimeOnMessageListeners[0];
      vi.spyOn(translationService, "translateHTML").mockResolvedValueOnce([["bonjour"]]);
      const sendResponse = vi.fn();

      const keepAlive = listener(
        {
          action: "translateHTML",
          translationService: "google",
          targetLanguage: "fr",
          sourceArray2d: [["hello"]],
          dontSortResults: false,
        },
        { tab: { incognito: true } },
        sendResponse
      );

      await flushTimers();

      expect(keepAlive).toBe(true);
      expect(translationService.translateHTML).toHaveBeenCalledWith(
        "google",
        "auto",
        "fr",
        [["hello"]],
        true,
        false
      );
      expect(sendResponse).toHaveBeenCalledWith([["bonjour"]]);
    });

    it("handles translateHTML message errors by responding with undefined", async () => {
      const translationService = await importActualTranslationService();
      const listener = mockState.runtimeOnMessageListeners[0];
      vi.spyOn(translationService, "translateHTML").mockRejectedValueOnce(new Error("html failed"));
      const sendResponse = vi.fn();

      listener(
        {
          action: "translateHTML",
          translationService: "google",
          targetLanguage: "fr",
          sourceArray2d: [["hello"]],
          dontSortResults: false,
        },
        {},
        sendResponse
      );

      await flushTimers();

      expect(sendResponse).toHaveBeenCalledWith();
    });

    it("handles translateText messages and translateText errors", async () => {
      const translationService = await importActualTranslationService();
      const listener = mockState.runtimeOnMessageListeners[0];
      const sendResponse = vi.fn();
      vi.spyOn(translationService, "translateText")
        .mockResolvedValueOnce(["bonjour"])
        .mockRejectedValueOnce(new Error("text failed"));

      const keepAlive = listener(
        {
          action: "translateText",
          translationService: "google",
          targetLanguage: "fr",
          sourceArray: ["hello"],
        },
        {},
        sendResponse
      );

      await flushTimers();
      listener(
        {
          action: "translateText",
          translationService: "google",
          targetLanguage: "fr",
          sourceArray: ["hello"],
        },
        {},
        sendResponse
      );
      await flushTimers();

      expect(keepAlive).toBe(true);
      expect(sendResponse.mock.calls[0]).toEqual([["bonjour"]]);
      expect(sendResponse.mock.calls[1]).toEqual([]);
    });

    it("handles translateSingleText messages and translateSingleText errors", async () => {
      const translationService = await importActualTranslationService();
      const listener = mockState.runtimeOnMessageListeners[0];
      const sendResponse = vi.fn();
      vi.spyOn(translationService, "translateSingleText")
        .mockResolvedValueOnce("bonjour")
        .mockRejectedValueOnce(new Error("single failed"));

      const keepAlive = listener(
        {
          action: "translateSingleText",
          translationService: "google",
          targetLanguage: "fr",
          source: "hello",
        },
        {},
        sendResponse
      );

      await flushTimers();
      listener(
        {
          action: "translateSingleText",
          translationService: "google",
          targetLanguage: "fr",
          source: "hello",
        },
        {},
        sendResponse
      );
      await flushTimers();

      expect(keepAlive).toBe(true);
      expect(sendResponse.mock.calls[0]).toEqual(["bonjour"]);
      expect(sendResponse.mock.calls[1]).toEqual([]);
    });

    it("handles removeTranslationsWithError message across all services", async () => {
      const translationService = await importTestableTranslationService();
      const listener = mockState.runtimeOnMessageListeners[0];
      const { serviceList } = translationService.__testHooks;
      const removers = [...serviceList.values()]
        .filter((service) => typeof service.removeTranslationsWithError === "function")
        .map((service) => vi.spyOn(service, "removeTranslationsWithError"));

      listener({ action: "removeTranslationsWithError" }, {}, vi.fn());

      removers.forEach((spy) => expect(spy).toHaveBeenCalledOnce());
    });

    it("handles debugTranslationConnectivity messages with probe results", async () => {
      await importActualTranslationService();
      const listener = mockState.runtimeOnMessageListeners[0];
      const sendResponse = vi.fn();
      mockState.fetchMock
        .mockResolvedValueOnce(createFetchResponse({ probe: "ok" }, { status: 200 }))
        .mockRejectedValueOnce(new Error("dns failure"))
        .mockResolvedValueOnce(createFetchResponse({ probe: "ok" }, { status: 204, statusText: "No Content" }))
        .mockResolvedValueOnce(createFetchResponse({ probe: "ok" }, { status: 200 }));

      const keepAlive = listener({ action: "debugTranslationConnectivity" }, {}, sendResponse);

      await flushTimers();
      await flushTimers();

      expect(keepAlive).toBe(true);
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          environment: expect.objectContaining({ inServiceWorker: true }),
          results: expect.objectContaining({
            googleapis: expect.objectContaining({ ok: true, status: 200 }),
            yandex: expect.objectContaining({ ok: false, error: "Error" }),
            bing: expect.objectContaining({ ok: true, status: 204 }),
            deepl: expect.objectContaining({ ok: true, status: 200 }),
          }),
        })
      );
    });
  });
});
