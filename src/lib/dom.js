/**
 * Shared DOM infrastructure helpers.
 *
 * getObserverRoot() — the ONLY allowed MutationObserver mount point.
 *
 * Why: real Turbo Drive (GitHub) replaces the <body> ELEMENT itself on
 * back-nav (verified live 2026-09-10: document.body !== oldBody after
 * goBack). An observer mounted on document.body dies with the old body —
 * the floating button group and dynamic translation both stop working
 * after SPA back-nav (bug 7, PR #30). The <html> element survives Turbo
 * navigation (verified live), so observing it with subtree:true catches
 * body replacement via childList mutations.
 *
 * Rule (CLAUDE.md "observer mount rule"): NEVER mount an observer on
 * document.body. Always use getObserverRoot().
 */
export function getObserverRoot() {
  return document.documentElement;
}
