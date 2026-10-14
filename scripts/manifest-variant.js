"use strict";

/**
 * manifest-variant.js — single source of truth for turning src/manifest.json
 * (JSON with // comments) into the per-target dist manifest.
 *
 * Plan 62 M1. The Firefox variant declares an event page instead of a service
 * worker, drops the Chrome-only offscreen permission, loads the IIFE content
 * script as a classic script, and adds the gecko identity + AMO-2026 required
 * data-collection consent declaration. Everything else must stay identical to
 * the Chrome output — enforced by tests/manifest/manifestVariant.test.js.
 */

// Immutable once the add-on is published on AMO (gecko id cannot change later).
const FIREFOX_GECKO_ID = "dualtran@seigwen.dev";
// Desktop floor: 140.0 == the current ESR line, and the first version that
// honors the AMO-2026 data collection consent key below. (113 would cover the
// static DNR rules the Edge engine ships, but the consent declaration would be
// silently ignored on 113-139.)
const FIREFOX_STRICT_MIN_VERSION = "140.0";
// Firefox for Android honors data_collection_permissions from 142.
const FIREFOX_ANDROID_STRICT_MIN_VERSION = "142.0";
// AMO 2026 hard requirement (new extensions): declare what is transmitted.
// Page text / selected text is sent to translation providers => websiteContent.
const FIREFOX_DATA_COLLECTION_REQUIRED = ["websiteContent"];

/**
 * Strip JS comments that are invalid in JSON. Handles full-line comments and
 * inline comments while preserving :// inside strings.
 * (Moved verbatim from webpack.common.js so the variant logic is unit-testable.)
 * @param {string} text
 * @returns {string}
 */
function stripComments(text) {
  const lines = String(text).split("\n");
  return lines
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//")) return "";
      let inString = false;
      let escape = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (!inString && ch === "/" && line[i + 1] === "/") {
          return line.slice(0, i).trimEnd();
        }
      }
      return line;
    })
    .join("\n");
}

/**
 * @param {string} rawText src/manifest.json as read from disk (with comments)
 * @returns {object} parsed manifest
 */
function parseSourceManifest(rawText) {
  return JSON.parse(stripComments(rawText));
}

/**
 * Firefox MV3 constraints applied to the Chrome manifest:
 * - no background.service_worker in Firefox (event page via background.scripts);
 * - no chrome.offscreen (Firefox WONTFIX; TTS degrades/falls back at runtime);
 * - the emitted bundles are classic IIFE, so content scripts load as classic;
 * - gecko identity + data collection consent for AMO.
 * @param {object} manifest parsed Chrome-manifest source
 * @returns {object} Firefox manifest
 */
function toFirefoxManifest(manifest) {
  const out = JSON.parse(JSON.stringify(manifest));
  out.background = {
    scripts: [manifest.background.service_worker],
    ...(manifest.background.type ? { type: manifest.background.type } : {}),
  };
  out.permissions = manifest.permissions.filter((p) => p !== "offscreen");
  for (const cs of out.content_scripts) delete cs.type;
  out.browser_specific_settings = {
    gecko: {
      id: FIREFOX_GECKO_ID,
      strict_min_version: FIREFOX_STRICT_MIN_VERSION,
      data_collection_permissions: {
        required: [...FIREFOX_DATA_COLLECTION_REQUIRED],
      },
    },
    gecko_android: {
      strict_min_version: FIREFOX_ANDROID_STRICT_MIN_VERSION,
    },
  };
  return out;
}

/**
 * @param {string} rawText src/manifest.json as read from disk (with comments)
 * @param {"chrome" | "firefox"} target
 * @returns {object}
 */
function buildManifest(rawText, target) {
  const manifest = parseSourceManifest(rawText);
  if (target === "firefox") return toFirefoxManifest(manifest);
  return manifest;
}

module.exports = {
  stripComments,
  parseSourceManifest,
  buildManifest,
  FIREFOX_GECKO_ID,
  FIREFOX_STRICT_MIN_VERSION,
  FIREFOX_ANDROID_STRICT_MIN_VERSION,
  FIREFOX_DATA_COLLECTION_REQUIRED,
};
