/**
 * Chromium runner for the conformance matrix (plan 84, P1).
 *
 * Playwright can see the extension's service worker (and therefore seed storage the same
 * way the extension itself reads it) and pierces open shadow roots, so this runner is the
 * simplest of the two.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

export const engine = "chromium";

/**
 * @param {{extensionDir: string, artifactsDir: string}} options
 */
export async function launch({ extensionDir, artifactsDir }) {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const userDataDir = fs.mkdtempSync("/tmp/dualtran-conf-cr-");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, "--no-first-run"],
  });

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 20000 });
  const extensionId = new URL(worker.url()).host;

  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  const api = {
    engine,
    context,
    page,
    extensionId,

    async setConfig(config) {
      await worker.evaluate((cfg) => chrome.storage.local.set(cfg), config);
      // Visiting the options page makes the extension's config observers fire, which is how
      // browser-e2e has always applied storage changes.
      await page.goto(`chrome-extension://${extensionId}/options/options.html`);
      await page.waitForTimeout(600);
    },

    async open(url) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    },

    async waitForFloating(timeout = 20000) {
      // The host is present but visually hidden until the panel is opened, so wait for
      // attachment, not visibility.
      await page.waitForSelector("#dualtran-floating-btn-host", { state: "attached", timeout });
    },

    /** Click a floating-button segment: "Google" or "Ai" (works on hidden/collapsed panels). */
    async clickFloating(kind) {
      const clicked = await page.evaluate((id) => {
        const host = document.getElementById("dualtran-floating-btn-host");
        const btn = host?.shadowRoot?.getElementById(id);
        if (!btn) return false;
        btn.click();
        return true;
      }, `btn${kind}`);
      if (!clicked) throw new Error(`floating button btn${kind} not found`);
    },

    /** Text of every injected translation node. */
    async translated() {
      return page.$$eval("translated", (nodes) => nodes.map((n) => n.textContent.trim()).filter(Boolean));
    },

    /** Raw shadow-root HTML — enough to assert on user-visible error text. */
    async floatingHtml() {
      return page.evaluate(() => {
        const host = document.getElementById("dualtran-floating-btn-host");
        return host?.shadowRoot?.innerHTML || "";
      });
    },

    /** Visible text of the floating panel (shadow root has no innerText on the host). */
    async floatingText() {
      return page.evaluate(() => {
        const host = document.getElementById("dualtran-floating-btn-host");
        const root = host?.shadowRoot;
        if (!root) return "";
        return Array.from(root.querySelectorAll("*"))
          .map((n) => n.getAttribute("title") || n.textContent || "")
          .filter(Boolean)
          .join("\n");
      });
    },

    async openOptions() {
      await page.goto(`chrome-extension://${extensionId}/options/options.html`);
    },

    /** Provider labels in the order the dropdown renders them. */
    async providerOrder() {
      return page.$$eval("#aiProvider option", (options) => options.map((o) => o.textContent.trim()));
    },

    async screenshot(name) {
      const file = path.join(artifactsDir, `${name}.png`);
      await page.screenshot({ path: file });
      return file;
    },

    async close() {
      await context.close();
    },
  };

  return api;
}
