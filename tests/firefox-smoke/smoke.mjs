#!/usr/bin/env node
/**
 * Firefox smoke suite (plan 62 M3).
 *
 * Boots a REAL Firefox (tools/firefox), installs dist/firefox as a temporary
 * add-on via WebDriver BiDi, opens a local fixture page and drives the
 * extension's own floating-button UI to translate the page. Asserts that
 * translated text lands in the DOM.
 *
 * Exit codes: 0 PASS, 1 FAIL, 2 SKIP-ENV (objective environment premise).
 * SKIP-ENV applies only to the network premise: if the browser itself cannot
 * reach translate.googleapis.com, translation cannot be asserted on.
 *
 * Known-issue priming step (see known-issues.md → "FF first-translation"):
 * on a FRESH profile the very first page translation of a session is silently
 * dropped by Firefox event-page lifecycle behaviour; opening any extension
 * page (here: the floating button's options shortcut) and retrying translates
 * reliably, including after event-page unload + refresh. Until the root cause
 * is fixed, the smoke uses that deterministic recipe.
 *
 * Prerequisites: `npm run build:firefox` and `node scripts/fetch-firefox-tools.mjs`.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST_FIREFOX = path.join(ROOT, "dist", "firefox");
const FIREFOX_BIN = path.join(ROOT, "tools", "firefox", "firefox");
const GECKODRIVER_BIN = path.join(ROOT, "tools", "geckodriver", "geckodriver");

const FIXTURE_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>DualTran FF smoke fixture</title></head>
<body>
<h1 id="smoke-h1">El veloz zorro marron salta sobre el perro perezoso</h1>
<p>La traduccion automatica permite leer paginas web en cualquier idioma.</p>
</body></html>`;

function fail(message) {
  console.error(`[ff-smoke] FAIL: ${message}`);
  process.exit(1);
}
function skipEnv(message) {
  console.error(`[ff-smoke] SKIP-ENV: ${message}`);
  process.exit(2);
}

for (const [label, p] of [
  ["dist/firefox (run `npm run build:firefox`)", DIST_FIREFOX],
  ["tools/firefox (run `node scripts/fetch-firefox-tools.mjs`)", FIREFOX_BIN],
  ["tools/geckodriver (run `node scripts/fetch-firefox-tools.mjs`)", GECKODRIVER_BIN],
]) {
  if (!fs.existsSync(p)) fail(`missing ${label}`);
}

const { Builder, By } = await import(path.join(ROOT, "node_modules", "selenium-webdriver", "index.js"));
const firefox = await import(path.join(ROOT, "node_modules", "selenium-webdriver", "firefox.js"));

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(FIXTURE_HTML);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const fixtureUrl = `http://127.0.0.1:${server.address().port}/fixture.html`;

const options = new firefox.Options();
options.setBinary(FIREFOX_BIN);
options.addArguments("-headless");
options.enableBidi();
const service = new firefox.ServiceBuilder(GECKODRIVER_BIN);

let driver;
try {
  console.log("[ff-smoke] launching Firefox + installing dist/firefox ...");
  driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .setFirefoxService(service)
    .build();
  const extension = await driver.installWebExtension(DIST_FIREFOX);
  console.log(`[ff-smoke] extension installed: ${extension.id}`);
  await driver.get(fixtureUrl);
  await driver.sleep(2500);

  // Network premise (objective): the BROWSER must be able to reach the
  // google translate host, otherwise this environment cannot assert it.
  const network = await driver.executeScript(`
    return (async () => {
      try {
        await fetch("https://translate.googleapis.com/robots.txt", { mode: "no-cors", cache: "no-store" });
        return "ok";
      } catch (e) { return "unreachable:" + e.name; }
    })();
  `);
  if (network !== "ok") skipEnv(`browser cannot reach translate.googleapis.com (${network})`);

  const waitForFloatingHost = () =>
    driver.wait(
      async () => !!(await driver.executeScript("return !!document.getElementById('dualtran-floating-btn-host')")),
      20000,
      "floating button host never appeared (content script not running?)"
    );

  const clickFloatingGoogle = async () => {
    const host = await driver.findElement(By.id("dualtran-floating-btn-host"));
    const shadow = await host.getShadowRoot();
    await (await shadow.findElement(By.id("btnGoogle"))).click();
  };

  const translatedCount = () =>
    driver.executeScript(
      "return [...document.querySelectorAll('translated')].filter(function (e) { return e.textContent.trim().length > 0; }).length"
    );

  // ── priming step (known-issue recipe, see header) ──
  await waitForFloatingHost();
  await driver.executeScript(`
    document.getElementById('dualtran-floating-btn-host')
      .shadowRoot.getElementById('btnOptionsShortcut').click();
  `);
  await driver.sleep(2500);
  const fixtureHandle = await driver.getWindowHandle();
  for (const handle of await driver.getAllWindowHandles()) {
    if (handle === fixtureHandle) continue;
    await driver.switchTo().window(handle);
    await driver.close();
  }
  await driver.switchTo().window(fixtureHandle);
  await driver.navigate().refresh();
  await driver.sleep(2000);

  // ── F1: page translation via the floating button ──
  await waitForFloatingHost();
  await clickFloatingGoogle();
  console.log("[ff-smoke] F1: clicked the floating Google button, waiting for translations ...");
  let ok = false;
  try {
    await driver.wait(async () => (await translatedCount()) >= 1, 30000, "no translated content appeared");
    ok = true;
  } catch (e) {
    console.error(`[ff-smoke] F1 wait failed: ${e.message}`);
  }

  const sample = await driver.executeScript(`
    return [...document.querySelectorAll('translated')]
      .filter(function (e) { return e.textContent.trim(); })
      .slice(0, 3)
      .map(function (e) { return e.textContent.trim().slice(0, 110); });
  `);
  const shot = await driver.takeScreenshot();
  const shotPath = ok ? "/tmp/dt-ff-smoke.png" : "/tmp/dt-ff-smoke-fail.png";
  fs.writeFileSync(shotPath, Buffer.from(shot, "base64"));
  console.log(`[ff-smoke] screenshot: ${shotPath}`);
  console.log(`[ff-smoke] translated sample: ${JSON.stringify(sample)}`);

  if (!ok) fail("F1 page translation produced no translated text");
  console.log("[ff-smoke] F1 PASS");
  console.log("[ff-smoke] all checks passed");
} finally {
  if (driver) await driver.quit().catch(() => {});
  server.close();
}
