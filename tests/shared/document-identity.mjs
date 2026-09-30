/**
 * Document-identity primitive (plan 36) — the "same-document premise" guard
 * for client-route roundtrip canary scenarios.
 *
 * Why this exists: the roundtrip scenarios test a structural premise — the
 * site navigates CLIENT-SIDE (the document survives; the router rebuilds the
 * DOM, so the extension must rebuild its hosts and restore translation). If a
 * site is redesigned to full-page navigations, back/forward degenerates into
 * a plain reload and the scenario silently becomes a shallow test. plan 34's
 * discipline: a premise-invalid run is typed SKIP-DATA (never a false green,
 * never a false red) — this module supplies the identity signals and the
 * pure classifier the executor uses.
 *
 * Signals (both per-document):
 *   - performance.timeOrigin — minted when a document is created; a full
 *     page load ALWAYS changes it (authoritative).
 *   - window.__dualtranDocToken — injected by the executor's init script
 *     (fresh random value per document; defense in depth).
 *
 * Measured 2026-09-30 (probe archive): on all five adopted sites a
 * client-route click keeps timeOrigin + token constant and popstate fires
 * per hop; astro/gitlab full-page navigations change timeOrigin.
 *
 * Constraints (mirrors tests/shared/host-state.mjs):
 *   - `readDocumentIdentityInPage` runs INSIDE the browser via
 *     page.evaluate — fully self-contained (Playwright serializes the
 *     function source; no module-scope closures).
 *   - `classifyDocumentIdentity` is pure logic (Node-side).
 *
 * Degenerate inputs NEVER produce a drift report: a missing/unreadable side
 * classifies as "unknown" (the caller decides the skip policy); a missing
 * token on one side falls back to timeOrigin (degraded but safe).
 *
 * @module document-identity
 */

/**
 * Browser-context reader: capture the current document's identity.
 * Pass to page.evaluate (no arguments).
 *
 * @returns {{token: string|null, timeOrigin: number|null}}
 */
export function readDocumentIdentityInPage() {
  let token = null;
  try {
    token = window.__dualtranDocToken ?? null;
  } catch {
    /* keep null */
  }
  let timeOrigin = null;
  try {
    const t = performance.timeOrigin;
    timeOrigin = typeof t === "number" && isFinite(t) ? t : null;
  } catch {
    /* keep null */
  }
  return { token, timeOrigin };
}

/**
 * Pure classifier: did the document survive the navigation?
 *
 * Rules:
 *   - either side missing/unreadable → "unknown" (never a false drift);
 *   - timeOrigin differs → "full-load" (authoritative signal);
 *   - timeOrigin equal + both tokens present + differ → "full-load"
 *     (defense in depth — catches exotic same-timeOrigin document swaps);
 *   - otherwise → "same-document".
 *
 * @param {{token: string|null, timeOrigin: number|null}|null} before
 * @param {{token: string|null, timeOrigin: number|null}|null} after
 * @returns {"same-document"|"full-load"|"unknown"}
 */
export function classifyDocumentIdentity(before, after) {
  if (!before || !after) return "unknown";
  const bT = before.timeOrigin;
  const aT = after.timeOrigin;
  if (typeof bT !== "number" || typeof aT !== "number" || !isFinite(bT) || !isFinite(aT)) {
    return "unknown";
  }
  if (bT !== aT) return "full-load";
  const bTok = before.token;
  const aTok = after.token;
  if (bTok != null && aTok != null && bTok !== aTok) return "full-load";
  return "same-document";
}
