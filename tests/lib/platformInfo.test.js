import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { configValues, configSet, onReadyMock } = vi.hoisted(() => ({
  configValues: {},
  configSet: vi.fn((key, value) => {
    configValues[key] = value;
  }),
  onReadyMock: vi.fn((cb) => cb()),
}));

vi.mock("../../src/lib/config.js", () => ({
  default: {
    get: (key) => configValues[key],
    set: configSet,
    onReady: onReadyMock,
  },
}));

const userAgents = {
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Mobile Safari/537.36",
  ios:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  blackberry:
    "Mozilla/5.0 (BlackBerry; U; BlackBerry 9900; en-US) AppleWebKit/534.11+ (KHTML, like Gecko) Version/7.1.0.346 Mobile Safari/534.11+",
  operaMini:
    "Opera/9.80 (Android; Opera Mini/36.2.2254/191.249; U; en) Presto/2.12.423 Version/12.16",
  windowsMobile:
    "Mozilla/5.0 (compatible; MSIE 10.0; Windows Phone 8.0; IEMobile/10.0; ARM; Touch)",
  desktop:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
};

function installChromeMock({ hasTabs = false } = {}) {
  globalThis.chrome = hasTabs ? { tabs: {} } : {};
}

function setNavigatorUserAgent(userAgent) {
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent },
    configurable: true,
  });
}

async function loadPlatformInfo() {
  const module = await import("../../src/lib/platformInfo.js");
  return module.default;
}

describe("platformInfo", () => {
  let originalNavigatorDescriptor;

  beforeEach(() => {
    vi.resetModules();
    originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "navigator"
    );
    Object.keys(configValues).forEach((key) => delete configValues[key]);
    configSet.mockClear();
    onReadyMock.mockClear();
    installChromeMock();
    setNavigatorUserAgent(userAgents.desktop);
  });

  afterEach(() => {
    delete globalThis.chrome;
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
    } else {
      delete globalThis.navigator;
    }
  });

  it("detects a desktop browser when no mobile pattern matches", async () => {
    const platformInfo = await loadPlatformInfo();

    expect(platformInfo.isMobile.any).toBeFalsy();
    expect(platformInfo.isDesktop.any).toBe(true);
  });

  it("detects Android user agents", async () => {
    setNavigatorUserAgent(userAgents.android);
    const platformInfo = await loadPlatformInfo();

    expect(platformInfo.isMobile.Android).toBeTruthy();
    expect(platformInfo.isMobile.any).toBeTruthy();
  });

  it("detects iOS user agents", async () => {
    setNavigatorUserAgent(userAgents.ios);
    const platformInfo = await loadPlatformInfo();

    expect(platformInfo.isMobile.iOS).toBeTruthy();
    expect(platformInfo.isDesktop.any).toBe(false);
  });

  it("detects BlackBerry user agents", async () => {
    setNavigatorUserAgent(userAgents.blackberry);
    const platformInfo = await loadPlatformInfo();

    expect(platformInfo.isMobile.BlackBerry).toBeTruthy();
  });

  it("detects Opera Mini user agents", async () => {
    setNavigatorUserAgent(userAgents.operaMini);
    const platformInfo = await loadPlatformInfo();

    expect(platformInfo.isMobile.Opera).toBeTruthy();
  });

  it("detects Windows Mobile user agents", async () => {
    setNavigatorUserAgent(userAgents.windowsMobile);
    const platformInfo = await loadPlatformInfo();

    expect(platformInfo.isMobile.Windows).toBeTruthy();
  });

  it("sets isMobile.any when any mobile matcher succeeds", async () => {
    setNavigatorUserAgent(userAgents.android);
    const platformInfo = await loadPlatformInfo();

    expect(platformInfo.isMobile.any).toBeTruthy();
  });

  it("sets isDesktop.any to the inverse of isMobile.any", async () => {
    setNavigatorUserAgent(userAgents.ios);
    const platformInfo = await loadPlatformInfo();

    expect(platformInfo.isMobile.any).toBeTruthy();
    expect(platformInfo.isDesktop.any).toBe(false);
  });

  it("saves the original user agent when chrome.tabs exists", async () => {
    installChromeMock({ hasTabs: true });
    setNavigatorUserAgent(userAgents.desktop);

    await loadPlatformInfo();

    expect(configSet).toHaveBeenCalledWith(
      "originalUserAgent",
      userAgents.desktop
    );
  });

  it("prefers the stored original user agent over navigator.userAgent", async () => {
    configValues.originalUserAgent = userAgents.android;
    setNavigatorUserAgent(userAgents.desktop);
    const platformInfo = await loadPlatformInfo();

    expect(platformInfo.isMobile.Android).toBeTruthy();
    expect(platformInfo.isDesktop.any).toBe(false);
  });
});
