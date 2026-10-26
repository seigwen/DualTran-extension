/**
 * Firefox runner for the conformance matrix (plan 84, P1).
 *
 * Two constraints shape this file:
 *   1. Selenium refuses to drive privileged (moz-extension://) browsing contexts, so every
 *      interaction happens inside the page: clicking the floating button goes through
 *      shadow DOM from page JS, not through Selenium elements.
 *   2. Storage cannot be written from outside the extension, so the runner builds a
 *      throwaway copy of dist/firefox with the scenario's AI provider baked into the
 *      bundled defaults. The shipped build is never modified.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const { Builder } = require(path.join(ROOT, "node_modules", "selenium-webdriver"));
const firefox = require(path.join(ROOT, "node_modules", "selenium-webdriver", "firefox"));

export const engine = "firefox";

/**
 * Copy dist/firefox and bake the scenario's AI config into the bundled defaults.
 *
 * Firefox temporary add-ons cannot have their storage written from the test process, and a
 * background probe proved unreliable (the extension imports its own defaults on first run
 * and can overwrite a write that lands too early). Patching the default config is
 * deterministic: the extension imports those defaults itself. The shipped build is never
 * modified — only a throwaway copy.
 *
 * @param {string} sourceDir
 * @param {{aiProvider?: string, providerConfigs?: object}} config
 * @returns {string} path to the throwaway extension
 */
export function buildSeededExtension(sourceDir, config = {}) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "dualtran-conf-ff-ext-"));
  fs.cpSync(sourceDir, target, { recursive: true });
  if (!config.aiProvider) return target;

  // The default config is bundled into every entry point (background, content script,
  // popup, options), so patch every bundle that carries the marker.
  const marker = 'aiProvider:"openai"';
  const injected = { aiProvider: config.aiProvider, ...(config.providerConfigs ? { providerConfigs: config.providerConfigs } : {}) };
  const patch = `${marker},${JSON.stringify(injected).slice(1, -1)}`;
  let patched = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) {
        const code = fs.readFileSync(full, "utf8");
        if (code.includes(marker)) {
          fs.writeFileSync(full, code.split(marker).join(patch));
          patched += 1;
        }
      }
    }
  };
  walk(target);
  if (patched === 0) {
    throw new Error("cannot seed config: default-config marker not found in any bundle");
  }
  return target;
}

/**
 * @param {{extensionDir: string, artifactsDir: string, config?: object}} options
 */
export async function launch({ extensionDir, artifactsDir, config = {} }) {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const seededDir = buildSeededExtension(extensionDir, config);

  const options = new firefox.Options();
  options.setBinary(path.join(ROOT, "tools", "firefox", "firefox"));
  options.enableBidi();
  // A fresh profile makes the extension pick its target language from the browser locale,
  // so pin it to Chinese — otherwise "translate" returns the English source unchanged.
  options.setPreference("intl.accept_languages", "zh-CN,zh,en-US,en");
  options.setPreference("devtools.console.stdout.content", true);
  const service = new firefox.ServiceBuilder(path.join(ROOT, "tools", "geckodriver", "geckodriver"));
  const driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .setFirefoxService(service)
    .build();

  await driver.installWebExtension(seededDir);
  await driver.sleep(1500);

  const runInPage = (script, ...args) => driver.executeScript(script, ...args);

  const api = {
    engine,
    driver,
    extensionId: "dualtran@seigwen.dev",

    async setConfig() {
      throw new Error("Firefox scenarios must pass config at launch — see buildSeededExtension()");
    },

    async open(url) {
      await driver.get(url);
      // Headless/background tabs report visibilityState "hidden", and pageTranslator
      // deliberately skips translating hidden pages. A spare tab activates the fixture,
      // then a reload starts the content script on a visible page (same trick as the
      // firefox-smoke suite).
      const handle = await driver.getWindowHandle();
      await driver.switchTo().newWindow("tab");
      await driver.sleep(600);
      await driver.close();
      await driver.switchTo().window(handle);
      await driver.sleep(600);
      await driver.navigate().refresh();
      await driver.sleep(800);
    },

    async waitForFloating(timeout = 20000) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const ok = await runInPage("return !!document.getElementById('dualtran-floating-btn-host')");
        if (ok) return;
        await driver.sleep(250);
      }
      throw new Error("floating button host never appeared");
    },

    async clickFloating(kind) {
      // The panel re-renders while the page settles, so the button can be missing for a
      // frame or two — poll instead of failing on the first attempt.
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const clicked = await runInPage(`
          const host = document.getElementById("dualtran-floating-btn-host");
          const root = host && host.shadowRoot;
          const btn = root ? root.getElementById("btn${kind}") : null;
          if (!btn) return false;
          btn.click();
          return true;
        `);
        if (clicked) return;
        await driver.sleep(300);
      }
      throw new Error(`floating button btn${kind} not found`);
    },

    async translated() {
      return runInPage(`
        return Array.from(document.querySelectorAll("translated"))
          .map((n) => (n.textContent || "").trim())
          .filter(Boolean);
      `);
    },

    async floatingHtml() {
      return runInPage(`
        const host = document.getElementById("dualtran-floating-btn-host");
        return (host && host.shadowRoot && host.shadowRoot.innerHTML) || "";
      `);
    },

    async floatingText() {
      return runInPage(`
        const host = document.getElementById("dualtran-floating-btn-host");
        const root = host && host.shadowRoot;
        if (!root) return "";
        return Array.from(root.querySelectorAll("*"))
          .map((n) => n.getAttribute("title") || n.textContent || "")
          .filter(Boolean)
          .join("\\n");
      `);
    },

    async screenshot(name) {
      const file = path.join(artifactsDir, `${name}.png`);
      const base64 = await driver.takeScreenshot();
      fs.writeFileSync(file, Buffer.from(base64, "base64"));
      return file;
    },

    async close() {
      await driver.quit();
      fs.rmSync(seededDir, { recursive: true, force: true });
    },
  };

  return api;
}
