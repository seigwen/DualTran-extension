/**
 * Plan 62 M1 — manifest variant transforms (Chrome vs Firefox).
 *
 * Seam under test: `scripts/manifest-variant.js`, the single source of truth
 * that turns src/manifest.json (JSON with // comments) into the per-target
 * dist manifest. Tests assert observable output objects only, never internals.
 *
 * RED-first contract (plan 62 §M1):
 *   - chrome output keeps today's behaviour (service worker + offscreen +
 *     module content script);
 *   - firefox output differs from chrome output ONLY on the declared
 *     whitelist asserted below (anti-drift guard for the second manifest).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SRC_MANIFEST = path.join(ROOT, "src/manifest.json");
const require = createRequire(import.meta.url);
const variant = require(path.join(ROOT, "scripts/manifest-variant.js"));

/**
 * Dotted-path diff of two JSON trees. Independent helper used to freeze the
 * exact set of differences between the chrome and firefox manifests.
 */
function diffPaths(a, b, prefix = "") {
  const out = [];
  const keys = new Set([
    ...Object.keys(a && typeof a === "object" ? a : {}),
    ...Object.keys(b && typeof b === "object" ? b : {}),
  ]);
  for (const k of keys) {
    const p = prefix ? prefix + "." + k : k;
    const va = a ? a[k] : undefined;
    const vb = b ? b[k] : undefined;
    const aIsArr = Array.isArray(va);
    const bIsArr = Array.isArray(vb);
    if (aIsArr || bIsArr) {
      const bothObjArrays =
        aIsArr &&
        bIsArr &&
        va.length === vb.length &&
        va.every((e) => e && typeof e === "object") &&
        vb.every((e) => e && typeof e === "object");
      if (bothObjArrays) {
        for (let i = 0; i < va.length; i++) {
          out.push(...diffPaths(va[i], vb[i], p + "." + i));
        }
      } else if (JSON.stringify(va) !== JSON.stringify(vb)) {
        out.push(p);
      }
    } else if (va && vb && typeof va === "object" && typeof vb === "object") {
      out.push(...diffPaths(va, vb, p));
    } else if (va !== vb) {
      out.push(p);
    }
  }
  return out;
}

function findContentScript(manifest) {
  return manifest.content_scripts.find((c) =>
    c.js.includes("/contentScript/contentScript.js")
  );
}

describe("stripComments", () => {
  it("removes full-line and inline comments but keeps :// inside strings", () => {
    const raw = [
      "{",
      "  // full line comment",
      '  "a": "https://example.com/x", // inline comment',
      '  "b": 1',
      "}",
    ].join("\n");
    expect(JSON.parse(variant.stripComments(raw))).toEqual({
      a: "https://example.com/x",
      b: 1,
    });
  });
});

describe("buildManifest('chrome')", () => {
  const out = variant.buildManifest(readFileSync(SRC_MANIFEST, "utf8"), "chrome");

  it("keeps the current Chrome contract (service worker, offscreen, module content script)", () => {
    expect(out.background.service_worker).toBe("/background/sw.js");
    expect(out.background.scripts).toBeUndefined();
    expect(out.permissions).toContain("offscreen");
    expect(findContentScript(out).type).toBe("module");
    expect(out.browser_specific_settings).toBeUndefined();
  });
});

describe("buildManifest('firefox')", () => {
  const raw = readFileSync(SRC_MANIFEST, "utf8");
  const chrome = variant.buildManifest(raw, "chrome");
  const ff = variant.buildManifest(raw, "firefox");

  it("declares an event page instead of a service worker", () => {
    expect(ff.background.scripts).toEqual(["/background/sw.js"]);
    expect(ff.background.type).toBe("module");
    expect(ff.background.service_worker).toBeUndefined();
  });

  it("drops the offscreen permission but keeps the rest", () => {
    expect(ff.permissions).not.toContain("offscreen");
    expect(ff.permissions).toContain("storage");
    expect(ff.permissions).toContain("activeTab");
    expect(ff.permissions).toContain("contextMenus");
    expect(ff.permissions).toContain("webRequest");
    expect(ff.permissions).toContain("alarms");
    expect(ff.permissions).toContain("declarativeNetRequest");
  });

  it("declares gecko settings with data collection consent (AMO 2026 requirement)", () => {
    const gecko = ff.browser_specific_settings && ff.browser_specific_settings.gecko;
    expect(gecko && typeof gecko === "object").toBe(true);
    expect(typeof gecko.id).toBe("string");
    expect(gecko.id.length > 0).toBe(true);
    expect(typeof gecko.strict_min_version).toBe("string");
    expect(Array.isArray(gecko.data_collection_permissions.required)).toBe(true);
    expect(gecko.data_collection_permissions.required.length > 0).toBe(true);
  });

  it("freezes the gecko version policy (desktop 140 / Android 142)", () => {
    expect(variant.FIREFOX_STRICT_MIN_VERSION).toBe("140.0");
    expect(variant.FIREFOX_ANDROID_STRICT_MIN_VERSION).toBe("142.0");
    expect(ff.browser_specific_settings.gecko.strict_min_version).toBe("140.0");
    expect(ff.browser_specific_settings.gecko_android.strict_min_version).toBe("142.0");
  });

  it("loads content scripts as classic scripts (bundle is a plain IIFE)", () => {
    expect(findContentScript(ff).type).toBeUndefined();
  });

  it("differs from chrome ONLY on the declared whitelist (anti-drift)", () => {
    expect(diffPaths(chrome, ff).sort()).toEqual([
      "background.scripts",
      "background.service_worker",
      "browser_specific_settings",
      "content_scripts.1.type",
      "permissions",
    ]);
  });
});
