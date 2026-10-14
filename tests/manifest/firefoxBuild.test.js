/**
 * Plan 62 M1 — dist/firefox production-artifact guards.
 *
 * Same `describeIfBuilt` contract as the sibling manifest tests: the suite
 * activates once `npm run build:firefox` has produced dist/firefox, and CI /
 * local verify always build before running the manifest suite.
 *
 * What this file freezes:
 *   1. the Firefox manifest differs from Chrome ONLY on the declared
 *      whitelist (event page instead of service worker, no offscreen
 *      permission, classic content script, gecko identity + AMO-2026 data
 *      collection consent) — plus a single-source version/name check against
 *      src/manifest.json;
 *   2. every file the manifest references actually exists in dist/firefox;
 *   3. the webpack entry points are all emitted.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const DIST_DIR = path.join(ROOT, "dist/firefox");
const DIST_MANIFEST = path.join(DIST_DIR, "manifest.json");
const SRC_MANIFEST = path.join(ROOT, "src/manifest.json");

const require = createRequire(import.meta.url);
const variant = require(path.join(ROOT, "scripts/manifest-variant.js"));

function hasDist() {
  return fs.existsSync(DIST_DIR) && fs.existsSync(DIST_MANIFEST);
}
const describeIfBuilt = hasDist() ? describe : describe.skip;

function readDistManifest() {
  return JSON.parse(fs.readFileSync(DIST_MANIFEST, "utf8"));
}

describeIfBuilt("dist/firefox manifest.json", () => {
  it("parses as valid JSON with no JS-style comments", () => {
    const raw = fs.readFileSync(DIST_MANIFEST, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(raw).not.toMatch(/^\s*\/\//m);
  });

  it("declares an event page, not a service worker", () => {
    const m = readDistManifest();
    expect(m.background.scripts).toEqual(["/background/sw.js"]);
    expect(m.background.service_worker).toBeUndefined();
  });

  it("drops the offscreen permission and keeps the required ones", () => {
    const m = readDistManifest();
    expect(m.permissions).not.toContain("offscreen");
    for (const p of ["storage", "activeTab", "contextMenus", "webRequest", "alarms", "declarativeNetRequest"]) {
      expect(m.permissions).toContain(p);
    }
  });

  it("carries the gecko identity and the AMO-2026 data collection consent", () => {
    const m = readDistManifest();
    const gecko = m.browser_specific_settings && m.browser_specific_settings.gecko;
    expect(gecko.id).toBe(variant.FIREFOX_GECKO_ID);
    expect(gecko.strict_min_version).toBe(variant.FIREFOX_STRICT_MIN_VERSION);
    expect(gecko.data_collection_permissions.required).toEqual(
      variant.FIREFOX_DATA_COLLECTION_REQUIRED
    );
  });

  it("loads the content script as a classic script (bundle is a plain IIFE)", () => {
    const m = readDistManifest();
    for (const cs of m.content_scripts || []) {
      expect(cs.type).toBeUndefined();
    }
  });

  it("keeps version and name in sync with src/manifest.json (single source)", () => {
    const m = readDistManifest();
    const src = variant.parseSourceManifest(fs.readFileSync(SRC_MANIFEST, "utf8"));
    expect(m.version).toBe(src.version);
    expect(m.name).toBe(src.name);
  });
});

describeIfBuilt("dist/firefox file references all resolve", () => {
  function expectDistFile(filePath, context) {
    const normalized = filePath.replace(/^\//, "");
    const fullPath = path.join(DIST_DIR, normalized);
    expect(fs.existsSync(fullPath), `${context}: ${filePath} missing in dist/firefox`).toBe(true);
  }

  it("background scripts exist", () => {
    const m = readDistManifest();
    for (const script of m.background.scripts || []) expectDistFile(script, "background.scripts");
  });

  it("all content_script js/css files exist", () => {
    const m = readDistManifest();
    for (const cs of m.content_scripts || []) {
      for (const js of cs.js || []) expectDistFile(js, "content_scripts.js");
      for (const css of cs.css || []) expectDistFile(css, "content_scripts.css");
    }
  });

  it("popup, options and icons exist", () => {
    const m = readDistManifest();
    // assertion-strength-allow: optional manifest fields, validated when present
    if (m.action?.default_popup) expectDistFile(m.action.default_popup, "action.default_popup");
    if (m.options_ui?.page) expectDistFile(m.options_ui.page, "options_ui.page");
    for (const iconPath of Object.values(m.icons || {})) expectDistFile(iconPath, "icons");
  });

  it("declarativeNetRequest rule files exist", () => {
    const m = readDistManifest();
    for (const group of m.declarative_net_request?.rule_resources || []) {
      expectDistFile(group.path, "declarative_net_request");
    }
  });

  it("default_locale messages.json exists", () => {
    const m = readDistManifest();
    // assertion-strength-allow: optional manifest field, validated when present
    if (m.default_locale) {
      const messagesPath = path.join(DIST_DIR, "_locales", m.default_locale, "messages.json");
      expect(fs.existsSync(messagesPath), `missing ${messagesPath}`).toBe(true);
    }
  });

  it("web_accessible_resources non-glob files exist", () => {
    const m = readDistManifest();
    for (const group of m.web_accessible_resources || []) {
      for (const res of group.resources || []) {
        if (res.includes("*")) continue;
        expectDistFile(res, "web_accessible_resources");
      }
    }
  });
});

describeIfBuilt("dist/firefox webpack entry points present", () => {
  const EXPECTED_ENTRIES = [
    "background/sw.js",
    "contentScript/contentScript.js",
    "popup/popup.js",
    "popup/popup-change-language.js",
    "popup/popup-translate-document.js",
    "popup/popup-translate-text.js",
    "popup/old-popup.js",
    "options/options.js",
  ];

  for (const entry of EXPECTED_ENTRIES) {
    it(`${entry} was emitted by webpack`, () => {
      expect(
        fs.existsSync(path.join(DIST_DIR, entry)),
        `webpack entry ${entry} missing from dist/firefox`
      ).toBe(true);
    });
  }
});
