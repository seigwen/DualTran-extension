import { beforeEach, describe, expect, it, vi } from "vitest";

const { configValues } = vi.hoisted(() => ({
  configValues: {
    targetLanguage: "fr",
    darkMode: "no",
  },
}));

vi.mock("../../src/lib/config.js", () => ({
  default: {
    get: (key) => configValues[key],
    onReady: vi.fn((callback) => {
      if (typeof callback === "function") callback();
      return Promise.resolve();
    }),
  },
}));

vi.mock("../../src/lib/languages.js", () => ({ default: {} }));
vi.mock("../../src/lib/i18n.js", () => ({}));

describe("popup-translate-document", () => {
  let xhrResponse;
  let xhrMode;
  let xhrProgressEvent;
  let submitGoogleSpy;
  let submitTranslateWebpagesSpy;

  class FakeXMLHttpRequest {
    open = vi.fn();

    send = vi.fn(() => {
      if (xhrProgressEvent && this.onprogress) {
        this.onprogress(xhrProgressEvent);
      }

      if (xhrMode === "error") {
        this.onerror?.(new Error("network error"));
        return;
      }

      this.onload?.({ target: { response: xhrResponse } });
    });
  }

  class FakeDataTransfer {
    constructor() {
      this.files = [];
      this.items = {
        add: (file) => {
          this.files = [file];
        },
      };
    }
  }

  function renderDom() {
    document.head.innerHTML = "";
    document.body.innerHTML = `
      <div id="send" style="display:none"></div>
      <div id="error"></div>
      <div id="selectService">
        <button id="service-google" data-name="google"></button>
        <button id="service-twp" data-name="translatewebpages"></button>
      </div>
      <div id="pleasewait"></div>
      <div id="googletranslate"></div>
      <div id="cannotusegoogle"></div>
      <div id="cannotDownload"></div>
      <div id="conversion"></div>
      <div id="conversionalert"></div>
      <form id="form_google"><input type="file"/><input name="tl" value=""/><input type="submit"/></form>
      <form id="form_translatewebpages"><input type="file"/><input type="submit"/></form>
    `;

    Object.defineProperty(document.querySelector("#form_google [type='file']"), "files", {
      configurable: true,
      writable: true,
      value: [],
    });
    Object.defineProperty(document.querySelector("#form_translatewebpages [type='file']"), "files", {
      configurable: true,
      writable: true,
      value: [],
    });

    submitGoogleSpy = vi
      .spyOn(document.querySelector("#form_google [type='submit']"), "click")
      .mockImplementation(() => {});
    submitTranslateWebpagesSpy = vi
      .spyOn(document.querySelector("#form_translatewebpages [type='submit']"), "click")
      .mockImplementation(() => {});
  }

  async function flushMicrotasks(times = 4) {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
  }

  async function loadModule() {
    await import("../../src/popup/popup-translate-document.js");
    await flushMicrotasks();
  }

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    configValues.targetLanguage = "fr";
    configValues.darkMode = "no";
    xhrResponse = new Uint8Array([1, 2, 3]).buffer;
    xhrMode = "success";
    xhrProgressEvent = { lengthComputable: true, loaded: 5, total: 10 };

    renderDom();
    globalThis.matchMedia = vi.fn(() => ({ matches: false }));
    globalThis.$ = document.querySelector.bind(document);
    globalThis.XMLHttpRequest = FakeXMLHttpRequest;
    globalThis.DataTransfer = FakeDataTransfer;
    window.close = vi.fn();

    globalThis.chrome = {
      i18n: {
        getMessage: vi.fn((key, value) => {
          if (key === "msgPleaseWait") return "Please wait";
          if (key === "msgFileLargerThan") return `Larger than ${value}`;
          return key;
        }),
      },
      tabs: {
        query: vi.fn((_opts, callback) => callback([{ id: 7, url: "https://example.com/document.pdf" }])),
        create: vi.fn(),
      },
    };
  });

  it("downloads the document, updates progress, and prepares the Google form", async () => {
    await loadModule();

    document.getElementById("service-google").click();
    await flushMicrotasks();

    expect(document.getElementById("pleasewait").textContent).toContain("50.0%");
    expect(document.getElementById("send").style.display).toBe("block");
    expect(document.querySelector("#form_google [name='tl']").value).toBe("fr");
    expect(document.querySelector("#form_google [type='file']").files).toHaveLength(1);
    expect(document.querySelector("#form_google [type='file']").files[0].name).toBe("document.pdf");
  });

  it("submits the prepared Google form and closes the window when send is clicked", async () => {
    await loadModule();

    document.getElementById("service-google").click();
    await flushMicrotasks();
    document.getElementById("send").click();

    expect(submitGoogleSpy).toHaveBeenCalledOnce();
    expect(window.close).toHaveBeenCalledOnce();
  });

  it("prepares the TranslateWebpages form without a target-language field", async () => {
    await loadModule();

    document.getElementById("service-twp").click();
    await flushMicrotasks();
    document.getElementById("send").click();

    expect(document.querySelector("#form_translatewebpages [type='file']").files).toHaveLength(1);
    expect(submitTranslateWebpagesSpy).toHaveBeenCalledOnce();
  });

  it("opens Google docs translation externally for file:// URLs", async () => {
    chrome.tabs.query.mockImplementation((_opts, callback) => callback([{ id: 7, url: "file:///tmp/document.pdf" }]));
    await loadModule();

    document.getElementById("service-google").click();

    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "https://translate.google.com/?op=docs" });
    expect(window.close).toHaveBeenCalledOnce();
  });

  it("opens TranslateWebpages externally for file:// URLs", async () => {
    chrome.tabs.query.mockImplementation((_opts, callback) => callback([{ id: 7, url: "file:///tmp/document.pdf" }]));
    await loadModule();

    document.getElementById("service-twp").click();

    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "https://translatewebpages.org/" });
    expect(window.close).toHaveBeenCalledOnce();
  });

  it("shows a file size error when Google receives a document larger than 10 MB", async () => {
    xhrResponse = new Uint8Array(1024 * 1024 * 10 + 1).buffer;
    await loadModule();

    document.getElementById("service-google").click();
    await flushMicrotasks();

    expect(document.getElementById("conversion").style.display).toBe("block");
    expect(document.getElementById("conversionalert").style.display).toBe("block");
    expect(document.getElementById("googletranslate").style.display).toBe("none");
    expect(document.getElementById("selectService").style.display).toBe("block");
    expect(document.getElementById("cannotusegoogle").textContent).toContain("10 MB");
    expect(document.getElementById("cannotusegoogle").style.display).toBe("block");
  });

  it("shows the cannot-download state when the XHR request fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    xhrMode = "error";
    await loadModule();

    document.getElementById("service-google").click();
    await flushMicrotasks();

    expect(errorSpy).toHaveBeenCalled();
    expect(document.getElementById("selectService").style.display).toBe("none");
    expect(document.getElementById("conversion").style.display).toBe("none");
    expect(document.getElementById("conversionalert").style.display).toBe("none");
    expect(document.getElementById("pleasewait").style.display).toBe("none");
    expect(document.getElementById("cannotDownload").style.display).toBe("block");
  });

  it("ignores clicks on unsupported service buttons", async () => {
    await loadModule();
    const unsupported = document.createElement("button");
    unsupported.dataset.name = "unsupported";
    document.getElementById("selectService").appendChild(unsupported);

    unsupported.click();
    await flushMicrotasks();

    expect(chrome.tabs.query).not.toHaveBeenCalled();
  });

  it("adds the light mode stylesheet when dark mode is disabled", async () => {
    configValues.darkMode = "no";

    await loadModule();

    expect(document.getElementById("lightModeElement")).not.toBeNull();
  });

  it("does not add the light mode stylesheet when dark mode is enabled", async () => {
    configValues.darkMode = "yes";

    await loadModule();

    expect(document.getElementById("lightModeElement")).toBeNull();
  });

  it("uses the system preference when dark mode is auto", async () => {
    configValues.darkMode = "auto";
    globalThis.matchMedia = vi.fn(() => ({ matches: false }));

    await loadModule();

    expect(document.getElementById("lightModeElement")).not.toBeNull();
  });
});
