/**
 * Arrival-path single source of truth (issue #72, mechanism 3).
 *
 * THE PROBLEM THIS SOLVES
 * An AI result can reach a block through three physically different paths:
 *
 *   1. memory-cache     — in-page aiCache hit (synchronous-ish)
 *   2. persistent-cache — storage-backed cache hit (async callback)
 *   3. stream           — network streaming (onMessage → parser → apply)
 *
 * #70 proved the paths are NOT interchangeable: the defect manifested only on
 * the non-streaming arrivals (streaming masks it because applyAiTranslatingState
 * claims the display mid-stream). The existing harness mocked the stream parser
 * away, so the ONE path the bug lived on had zero coverage.
 *
 * The governance gap: display modes have a symmetry lint, mock pages have a
 * branch-enumeration lint, but "arrival path" had no equivalent — a new path
 * could be added to production with no mechanism noticing, and a path could be
 * silently dropped from tests (the #70 escape).
 *
 * THE MECHANISM
 * This module is the SSOT for the path list. Production code carries a
 * `@arrival-path: <id>` tag comment on every arrival site; the meta-test
 * (tests/scripts/arrivalPathSymmetry.test.js) asserts:
 *   - every tagged production site maps to an id in this list, and
 *   - every id in this list is exercised by the interaction matrix, and
 *   - every id in this list is tagged at least once in production.
 * Adding/removing a path on either side without the other → red.
 */

/** Canonical arrival-path ids. Order matters for test reporting stability. */
export const ARRIVAL_PATH_IDS = ["memory-cache", "persistent-cache", "stream"];

/** Human-readable descriptions (used in failure messages). */
export const ARRIVAL_PATH_DESCRIPTIONS = {
  "memory-cache": "in-page aiCache hit (non-streaming, synchronous-ish)",
  "persistent-cache": "storage-backed cache hit via chrome.runtime callback",
  stream: "network streaming through the real stream parser",
};

/** The production file whose arrival sites must be tagged. */
export const ARRIVAL_SITE_FILE = "src/contentScript/pageTranslator.js";

/** Matches a `@arrival-path: <id>` tag comment. */
export const ARRIVAL_TAG_RE = /@arrival-path:\s*([a-z-]+)/g;
