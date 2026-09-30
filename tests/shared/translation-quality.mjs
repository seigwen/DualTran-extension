/**
 * Translation-quality gate (plan 34) — shared by the real-site canary
 * executor (scripts/real-site-verify.mjs) and any future consumer.
 *
 * Why this exists: two false-green holes were measured on the canary
 * (2026-09-29/30):
 *   ① the old assertion only counted `<translated>` / `.dualtran-result-container`
 *      nodes — a Google-429 window PASSED bug7 while all 150 nodes were empty;
 *   ② an unseeded profile resolved target language to `en`, so "translated"
 *      text was the English source (149 non-empty / 0 CJK) — the canary had
 *      never verified a REAL translation.
 *
 * The gate closes both: metrics come from the collector below; the pure
 * `evaluateQualityGate` demands a non-empty floor AND a CJK ratio floor.
 * 429 windows fail the floor (0 non-empty); en→en fails the CJK ratio (0).
 * Callers map a gate failure to typed-skip attribution (SKIP-ENV) when the
 * Google endpoint is concurrently throttled — see the executor.
 *
 * Design constraints (mirrors tests/shared/host-state.mjs):
 *   - `collectTranslationQualityInPage` runs INSIDE the browser via
 *     page.evaluate — it must be fully self-contained (no module-scope
 *     closures); Playwright serializes the function source.
 *   - `evaluateQualityGate` is pure logic (Node-side).
 *
 * Selector union note: in newLine mode `<translated>` and
 * `.dualtran-result-container` are the SAME element (measured 150/150 on
 * a live page) — a Set dedupes; double-counting would inflate the floor.
 *
 * @module translation-quality
 */

/** Calibrated defaults (plan 34 §三.A). Site scenarios may override via `quality`. */
export const DEFAULT_QUALITY = {
  minNonEmptyFloor: 10,
  minNonEmptyRatio: 0.2,
  minCjkRatio: 0.3,
};

/**
 * Browser-context collector: measure translation reality on the page.
 * Pass to page.evaluate (no arguments).
 *
 * @returns {{count: number, nonEmpty: number, cjk: number}}
 *   count    — distinct translation-output elements (union of both selectors)
 *   nonEmpty — elements whose trimmed textContent is non-empty
 *   cjk      — elements whose text contains at least one CJK character
 */
export function collectTranslationQualityInPage() {
  const els = new Set([
    ...document.querySelectorAll("translated"),
    ...document.querySelectorAll(".dualtran-result-container"),
  ]);
  let count = 0;
  let nonEmpty = 0;
  let cjk = 0;
  for (const el of els) {
    count++;
    const t = (el.textContent || "").trim();
    if (!t) continue;
    nonEmpty++;
    if (/[\u4e00-\u9fff]/.test(t)) cjk++;
  }
  return { count, nonEmpty, cjk };
}

/**
 * Pure threshold logic. Partial overrides merge over DEFAULT_QUALITY.
 *
 * ok ⇔ nonEmpty ≥ max(floor, ceil(ratio × count)) AND cjk/nonEmpty ≥ minCjkRatio
 * (boundaries inclusive — "≥" not ">").
 *
 * @param {{count: number, nonEmpty: number, cjk: number}} metrics
 * @param {{minNonEmptyFloor?: number, minNonEmptyRatio?: number, minCjkRatio?: number}} [thresholds]
 * @returns {{ok: boolean, minNonEmpty: number, cjkRatio: number}}
 */
export function evaluateQualityGate(metrics, thresholds = {}) {
  const t = { ...DEFAULT_QUALITY, ...thresholds };
  const minNonEmpty = Math.max(
    t.minNonEmptyFloor,
    Math.ceil(t.minNonEmptyRatio * metrics.count)
  );
  const cjkRatio = metrics.nonEmpty ? metrics.cjk / metrics.nonEmpty : 0;
  const ok = metrics.nonEmpty >= minNonEmpty && cjkRatio >= t.minCjkRatio;
  return { ok, minNonEmpty, cjkRatio };
}
