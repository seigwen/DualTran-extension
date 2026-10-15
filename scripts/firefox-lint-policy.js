"use strict";

/**
 * firefox-lint-policy.js — web-ext lint warning allowlist for the Firefox
 * build (plan 62 M1). Every entry is a triaged, archived warning class:
 * see the reason strings for why each one is safe to tolerate.
 *
 * Policy: errors always fail; a warning fails unless its (code, message)
 * pair is listed here, so NEW regressions cannot hide behind a known code.
 */

const ALLOWED_WARNING_PAIRS = [
  {
    code: "UNSUPPORTED_API",
    message: "i18n.translateDocument is not supported",
    reason:
      "translateDocument is not a browser API at all: it is the extension's " +
      "own TWP-heritage helper defined on the chrome.i18n object (src/lib/i18n.js). " +
      "addons-linter matches the callee name and cannot know it is self-defined.",
  },
  {
    code: "UNSAFE_VAR_ASSIGNMENT",
    message: "Unsafe assignment to innerHTML",
    reason:
      "Pre-existing, CWS-shipped code paths (toastify-js notifications and the " +
      "selection panels). Not introduced by the Firefox target; content is " +
      "extension-controlled. Triage is tracked as existing accepted risk.",
  },
  {
    code: "DANGEROUS_EVAL",
    message: "The Function constructor is eval.",
    reason:
      "Webpack runtime global-object fallback (`this || new Function('return this')()`). " +
      "The branch is unreachable in MV3 contexts (globalThis always exists) and is " +
      "wrapped in try/catch; kept because stripping it in this cycle would change " +
      "the shipped Chrome bundle bytes.",
  },
];

/**
 * @param {{code: string, message: string}[]} warnings web-ext lint warnings
 * @returns {{code: string, message: string}[]} warnings outside the allowlist
 */
function findUnknownWarnings(warnings) {
  return warnings.filter(
    (w) =>
      !ALLOWED_WARNING_PAIRS.some(
        (p) => p.code === w.code && p.message === w.message
      )
  );
}

module.exports = { ALLOWED_WARNING_PAIRS, findUnknownWarnings };
