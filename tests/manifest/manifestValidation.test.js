import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SRC_MANIFEST = path.join(ROOT, "src/manifest.json");

function stripComments(text) {
  return text.split("\n").map((line) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//")) return "";
    let inString = false;
    let escape = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (!inString && ch === "/" && line[i + 1] === "/") {
        return line.slice(0, i).trimEnd();
      }
    }
    return line;
  }).join("\n");
}

function readManifest() {
  const raw = fs.readFileSync(SRC_MANIFEST, "utf8");
  return JSON.parse(stripComments(raw));
}

// ---------------------------------------------------------------------------
// 1. Source manifest.json must produce valid JSON after comment-stripping
// ---------------------------------------------------------------------------
describe("manifest.json validity", () => {
  it("parses as valid JSON after stripping single-line comments", () => {
    const raw = fs.readFileSync(SRC_MANIFEST, "utf8");
    expect(() => JSON.parse(stripComments(raw))).not.toThrow();
  });

  it("does not contain block comments (/* */) outside string values", () => {
    const raw = fs.readFileSync(SRC_MANIFEST, "utf8");
    const stripped = stripComments(raw);
    const withoutStrings = stripped.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    expect(withoutStrings).not.toMatch(/\/\*[\s\S]*?\*\//);
  });
});

// ---------------------------------------------------------------------------
// 2. Required MV3 fields
// ---------------------------------------------------------------------------
describe("manifest required fields", () => {
  const manifest = readManifest();

  it("has manifest_version 3", () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it("has a non-empty name", () => {
    expect(typeof manifest.name).toBe("string");
    expect(manifest.name.length).toBeGreaterThan(0);
  });

  it("has a valid semver-ish version", () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("has a description", () => {
    expect(typeof manifest.description).toBe("string");
    expect(manifest.description.length).toBeGreaterThan(0);
  });

  it("declares a service_worker background (MV3)", () => {
    expect(manifest.background).toBeDefined();
    expect(typeof manifest.background.service_worker).toBe("string");
    expect(manifest.background).not.toHaveProperty("page");
    expect(manifest.background).not.toHaveProperty("scripts");
  });
});

// ---------------------------------------------------------------------------
// 3. Permissions: no duplicates, all recognized
// ---------------------------------------------------------------------------
describe("manifest permissions", () => {
  const manifest = readManifest();

  const KNOWN_CHROME_PERMISSIONS = new Set([
    "activeTab", "alarms", "background", "bookmarks", "browsingData",
    "certificateProvider", "clipboardRead", "clipboardWrite",
    "contentSettings", "contextMenus", "cookies", "debugger",
    "declarativeContent", "declarativeNetRequest",
    "declarativeNetRequestFeedback", "declarativeNetRequestWithHostAccess",
    "desktopCapture", "dns", "documentScan", "downloads",
    "downloads.shelf", "downloads.ui", "enterprise.deviceAttributes",
    "enterprise.hardwarePlatform", "enterprise.networkingAttributes",
    "enterprise.platformKeys", "favicon", "fileBrowserHandler",
    "fileSystemProvider", "fontSettings", "gcm", "geolocation",
    "history", "identity", "idle", "loginState", "management",
    "nativeMessaging", "notifications", "offscreen", "pageCapture",
    "platformKeys", "power", "printerProvider", "printing",
    "printingMetrics", "privacy", "processes", "proxy",
    "readingList", "runtime", "scripting", "search", "sessions",
    "sidePanel", "storage", "system.cpu", "system.display",
    "system.memory", "system.storage", "tabCapture", "tabGroups",
    "tabs", "topSites", "tts", "ttsEngine", "unlimitedStorage",
    "vpnProvider", "wallpaper", "webAuthenticationProxy",
    "webNavigation", "webRequest", "webRequestBlocking",
  ]);

  it("has no duplicate permissions", () => {
    const perms = manifest.permissions || [];
    const seen = new Set();
    const duplicates = [];
    for (const p of perms) {
      if (seen.has(p)) duplicates.push(p);
      seen.add(p);
    }
    expect(duplicates).toEqual([]);
  });

  it("has no duplicate optional_permissions", () => {
    const perms = manifest.optional_permissions || [];
    const seen = new Set();
    const duplicates = [];
    for (const p of perms) {
      if (seen.has(p)) duplicates.push(p);
      seen.add(p);
    }
    expect(duplicates).toEqual([]);
  });

  it("all permissions are recognized Chrome permissions", () => {
    const perms = manifest.permissions || [];
    const unknown = perms.filter((p) => !KNOWN_CHROME_PERMISSIONS.has(p));
    expect(unknown).toEqual([]);
  });

  it("all optional_permissions are recognized Chrome permissions", () => {
    const perms = manifest.optional_permissions || [];
    const unknown = perms.filter((p) => !KNOWN_CHROME_PERMISSIONS.has(p));
    expect(unknown).toEqual([]);
  });

  it("no permission appears in both permissions and optional_permissions", () => {
    const required = new Set(manifest.permissions || []);
    const optional = manifest.optional_permissions || [];
    const overlap = optional.filter((p) => required.has(p));
    expect(overlap).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Host permissions format
// ---------------------------------------------------------------------------
describe("manifest host_permissions", () => {
  const manifest = readManifest();

  it("all host_permissions are valid match patterns", () => {
    const hostPerms = manifest.host_permissions || [];
    const matchPatternRe = /^(https?|\*):\/\/(\*|(\*\.)?[^/*]+)\/.*/;
    for (const hp of hostPerms) {
      expect(hp, `invalid host pattern: ${hp}`).toMatch(matchPatternRe);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. All file references in manifest point to files that exist in src/
// ---------------------------------------------------------------------------
describe("manifest file references exist in src/", () => {
  const manifest = readManifest();
  const srcDir = path.join(ROOT, "src");

  function expectFileExists(filePath, context) {
    const normalized = filePath.replace(/^\//, "");
    const fullPath = path.join(srcDir, normalized);
    expect(fs.existsSync(fullPath), `${context}: ${filePath} not found at ${fullPath}`).toBe(true);
  }

  it("service_worker file exists", () => {
    expectFileExists(manifest.background.service_worker, "background.service_worker");
  });

  it("all content_script js files exist", () => {
    for (const cs of manifest.content_scripts || []) {
      for (const js of cs.js || []) {
        expectFileExists(js, "content_scripts.js");
      }
      for (const css of cs.css || []) {
        expectFileExists(css, "content_scripts.css");
      }
    }
  });

  it("action popup file exists", () => {
    if (manifest.action?.default_popup) {
      expectFileExists(manifest.action.default_popup, "action.default_popup");
    }
  });

  it("action default_icon file exists", () => {
    if (typeof manifest.action?.default_icon === "string") {
      expectFileExists(manifest.action.default_icon, "action.default_icon");
    }
  });

  it("options_ui page file exists", () => {
    if (manifest.options_ui?.page) {
      expectFileExists(manifest.options_ui.page, "options_ui.page");
    }
  });

  it("all icon files exist", () => {
    for (const [size, iconPath] of Object.entries(manifest.icons || {})) {
      expectFileExists(iconPath, `icons.${size}`);
    }
  });

  it("all web_accessible_resources files exist (non-glob)", () => {
    for (const group of manifest.web_accessible_resources || []) {
      for (const res of group.resources || []) {
        if (res.includes("*")) continue;
        expectFileExists(res, "web_accessible_resources");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 6. i18n: default_locale dir exists and all __MSG_*__ keys are defined
// ---------------------------------------------------------------------------
describe("manifest i18n", () => {
  const manifest = readManifest();

  it("default_locale messages.json exists", () => {
    const locale = manifest.default_locale;
    expect(locale).toBeDefined();
    const messagesPath = path.join(ROOT, "src/_locales", locale, "messages.json");
    expect(fs.existsSync(messagesPath), `missing ${messagesPath}`).toBe(true);
  });

  it("all __MSG_*__ placeholders in manifest have matching i18n keys", () => {
    const locale = manifest.default_locale;
    const messagesPath = path.join(ROOT, "src/_locales", locale, "messages.json");
    const messages = JSON.parse(fs.readFileSync(messagesPath, "utf8"));
    const raw = fs.readFileSync(SRC_MANIFEST, "utf8");
    const msgRefs = [...raw.matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]);
    const missing = msgRefs.filter((key) => !messages[key]);
    expect(missing, `i18n keys missing from ${locale}/messages.json`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. MV3 specific: no forbidden keys
// ---------------------------------------------------------------------------
describe("manifest MV3 constraints", () => {
  const manifest = readManifest();

  it("does not use browser_action (MV2 only)", () => {
    expect(manifest).not.toHaveProperty("browser_action");
  });

  it("does not use page_action (MV2 only)", () => {
    expect(manifest).not.toHaveProperty("page_action");
  });

  it("does not use background.scripts (MV2 only)", () => {
    expect(manifest.background).not.toHaveProperty("scripts");
  });

  it("does not use background.page (MV2 only)", () => {
    expect(manifest.background).not.toHaveProperty("page");
  });

  it("CSP does not contain unsafe-eval or unsafe-inline", () => {
    const csp = manifest.content_security_policy;
    if (!csp) return;
    const cspStr = JSON.stringify(csp);
    expect(cspStr).not.toContain("unsafe-eval");
    expect(cspStr).not.toContain("unsafe-inline");
  });
});

// ---------------------------------------------------------------------------
// 8. commands: max 4 suggested_key commands (Chrome limit)
// ---------------------------------------------------------------------------
describe("manifest commands", () => {
  const manifest = readManifest();

  it("has at most 4 commands with suggested_key (Chrome limit)", () => {
    const commands = manifest.commands || {};
    const withKeys = Object.values(commands).filter((c) => c.suggested_key);
    expect(withKeys.length).toBeLessThanOrEqual(4);
  });
});
