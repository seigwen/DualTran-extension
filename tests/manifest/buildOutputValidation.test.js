import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const DIST_DIR = path.join(ROOT, "dist/chrome");
const DIST_MANIFEST = path.join(DIST_DIR, "manifest.json");

function hasDist() {
  return fs.existsSync(DIST_DIR) && fs.existsSync(DIST_MANIFEST);
}

const describeIfBuilt = hasDist() ? describe : describe.skip;

describeIfBuilt("dist/chrome manifest.json is valid JSON", () => {
  it("parses without error (no comments, no trailing commas)", () => {
    const raw = fs.readFileSync(DIST_MANIFEST, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("contains no JS-style comments", () => {
    const raw = fs.readFileSync(DIST_MANIFEST, "utf8");
    expect(raw).not.toMatch(/^\s*\/\//m);
    const withoutStrings = raw.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    expect(withoutStrings).not.toMatch(/\/\*[\s\S]*?\*\//);
  });
});

describeIfBuilt("dist/chrome file references all resolve", () => {
  let manifest;

  function readDistManifest() {
    if (!manifest) {
      manifest = JSON.parse(fs.readFileSync(DIST_MANIFEST, "utf8"));
    }
    return manifest;
  }

  function expectDistFile(filePath, context) {
    const normalized = filePath.replace(/^\//, "");
    const fullPath = path.join(DIST_DIR, normalized);
    expect(fs.existsSync(fullPath), `${context}: ${filePath} missing in dist/chrome`).toBe(true);
  }

  it("background service_worker exists", () => {
    const m = readDistManifest();
    expectDistFile(m.background.service_worker, "background.service_worker");
  });

  it("all content_script js/css files exist", () => {
    const m = readDistManifest();
    for (const cs of m.content_scripts || []) {
      for (const js of cs.js || []) expectDistFile(js, "content_scripts.js");
      for (const css of cs.css || []) expectDistFile(css, "content_scripts.css");
    }
  });

  it("popup HTML exists", () => {
    const m = readDistManifest();
    if (m.action?.default_popup) {
      expectDistFile(m.action.default_popup, "action.default_popup");
    }
  });

  it("default_icon exists", () => {
    const m = readDistManifest();
    if (typeof m.action?.default_icon === "string") {
      expectDistFile(m.action.default_icon, "action.default_icon");
    }
  });

  it("options page exists", () => {
    const m = readDistManifest();
    if (m.options_ui?.page) {
      expectDistFile(m.options_ui.page, "options_ui.page");
    }
  });

  it("all icon files exist", () => {
    const m = readDistManifest();
    for (const [size, iconPath] of Object.entries(m.icons || {})) {
      expectDistFile(iconPath, `icons.${size}`);
    }
  });

  it("default_locale messages.json exists", () => {
    const m = readDistManifest();
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

describeIfBuilt("dist/chrome webpack entry points present", () => {
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
        `webpack entry ${entry} missing from dist/chrome`,
      ).toBe(true);
    });
  }
});
