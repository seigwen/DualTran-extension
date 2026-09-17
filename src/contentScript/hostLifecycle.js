/**
 * hostLifecycle.js — unified host lifecycle management (C1, M5).
 *
 * Problem (doc 13, section C1): the two persistent Shadow-DOM host components
 * (floatingBtn, singletonBtnGroup) each implemented their own
 * "detect — rebuild — clean up" logic; bug 8 / #40 / #43 all required
 * symmetric fixes in both files. This module owns the mechanism once:
 *
 *   - the functional-host health predicate (single implementation,
 *     previously duplicated verbatim in both components)
 *   - the explicit `enabled` flag ("should this host exist"), replacing
 *     three implicit per-component sources (`divElement === null`,
 *     `_singleton.host === null`, the dead `singletonInitialized`)
 *   - the rebuild mechanism (remove every stale copy → create), which
 *     guarantees single-instance convergence (issue #43)
 *   - the eager trigger subscription (popstate / MutationObserver /
 *     pageshow), installed once, applying to every `recovery: "eager"`
 *     host — `recovery: "lazy"` hosts keep their interaction-driven
 *     recovery (the "no interaction → no rebuild" contract that
 *     prevents ghost rebuilds mid-hover)
 *
 * Components keep their policy: when to enable/disable, what create()
 * builds (element + shadow root + listeners + state seeding), and all
 * UI/domain logic. uiStateStore is untouched — lifecycle ⊥ state.
 *
 * Acceptance ruler (M5): a third persistent host = one registerHost()
 * call and it automatically gets the predicate, the eager subscription
 * (if declared), duplicate convergence, and disable blocking.
 *
 * Timing contract (verbatim from floatingBtn — these numbers encode
 * the bug 7 / bug 8 lessons; do NOT "optimize" them):
 *   - popstate: 200ms debounce before the health check (Turbo Drive
 *     back-nav may still be fetching when popstate fires)
 *   - MutationObserver: 300ms debounce, mounted on getObserverRoot()
 *     (document.documentElement) — NEVER document.body: Turbo replaces
 *     the <body> ELEMENT itself on back-nav, so a body-mounted observer
 *     dies with the old body (bug 7, PR #30)
 *   - pageshow(persisted): immediate check (bfcache restore edge cases)
 *
 * Health predicate semantics (issue #40 + #43): `count === 1` is
 * load-bearing — a "one exists" check let an invisible duplicate
 * survive indefinitely when the first match happened to be healthy
 * (healthy-first duplicate flavor). Any count != 1 → not functional →
 * rebuild, and the rebuild removes every stale copy first.
 *
 * Robustness (Q5): a create() exception is caught and logged; the
 * eager subscription stays alive (the old disconnect→show→re-observe
 * dance in floatingBtn could permanently kill the observer if show()
 * threw mid-rebuild).
 */

import { getObserverRoot } from "../lib/dom.js";

const POPSTATE_DELAY_MS = 200;
const OBSERVER_DEBOUNCE_MS = 300;

/**
 * Registered hosts: hostId → record. One record per host id; a
 * re-registration replaces the record (fresh module instances after
 * vi.resetModules() get a fresh registry too).
 * @type {Map<string, {hostId: string, create: Function, recovery: string, enabled: boolean}>}
 */
const registry = new Map();

// ── Eager subscription state (installed once, module lifetime) ──
let _eagerInstalled = false;
let _popstateTimer = null;
let _observer = null;
let _observerTimer = null;

/**
 * Check whether a functional host exists for the given host id.
 *
 * A host is functional only when it is connected AND has a shadow root
 * AND is the ONLY host copy in the DOM. Shadow-less shells come from
 * Turbo snapshot cloneNode() renders (cloneNode does NOT clone shadow
 * roots); duplicates come from snapshot + live hosts coexisting.
 *
 * This is the single implementation of the predicate — the two
 * component-local copies (floatingBtn.js / singletonBtnGroup.js) were
 * removed in the C1 migration.
 *
 * @param {string} hostId — element id (plain CSS id selector safe)
 * @returns {boolean}
 */
export function hasFunctionalHost(hostId) {
  const hosts = document.querySelectorAll("#" + hostId);
  if (hosts.length !== 1) return false;
  const host = hosts[0];
  return !!(document.body.contains(host) && host.shadowRoot);
}

/**
 * Remove every host copy (stale shells and duplicates included).
 * @param {string} hostId
 */
function removeAllHostCopies(hostId) {
  document.querySelectorAll("#" + hostId).forEach((el) => el.remove());
}

/**
 * Idempotent ensure: enabled ∧ !healthy → clear copies → create.
 * Healthy hosts are left alone (no rebuild — preserves the tested
 * "no ghost rebuild" contract).
 * @param {{hostId: string, create: Function, enabled: boolean}} record
 */
function ensureRecord(record) {
  if (!record.enabled) return;
  if (hasFunctionalHost(record.hostId)) return;
  console.log("[hostLifecycle] host missing or degraded, rebuilding:", record.hostId);
  removeAllHostCopies(record.hostId);
  try {
    record.create();
  } catch (e) {
    console.warn(
      "[hostLifecycle] create() failed for " + record.hostId + " — subscription stays alive",
      e
    );
  }
}

/**
 * Run ensureRecord for every enabled eager host. A throwing create()
 * for one host never blocks the others (caught inside ensureRecord).
 */
function ensureAllEager() {
  registry.forEach((record) => {
    if (record.recovery !== "eager") return;
    ensureRecord(record);
  });
}

/**
 * Install the shared eager subscriptions once (first eager registration).
 * All three triggers only check enabled eager hosts; the idempotent
 * ensure makes a rebuild-triggered rebuild a no-op (no disconnect dance
 * needed), and create() exceptions cannot kill the subscription.
 */
function installEagerSubscriptions() {
  if (_eagerInstalled) return;
  _eagerInstalled = true;

  // Browser forward/back navigation (popstate): Turbo/pjax replace the
  // DOM; the 200ms debounce absorbs the fetch latency (bug 8 timing).
  window.addEventListener("popstate", () => {
    if (_popstateTimer) clearTimeout(_popstateTimer);
    _popstateTimer = setTimeout(() => {
      _popstateTimer = null;
      ensureAllEager();
    }, POPSTATE_DELAY_MS);
  });

  // DOM-replacement complement: SPA link navigation (pushState only)
  // does not fire popstate, and when the SPA framework loads slowly the
  // popstate check can be too early. Debounce 300ms to prevent loops.
  //
  // Debounce form: clear + reschedule ("check 300ms after the last
  // observed mutation batch"). Deliberately NOT a `if (timer) return`
  // null-gate: an external clearTimeout (unit-test fake-timer resets call
  // vi.clearAllTimers()) cancels the timer without nulling this module's
  // id, and a null-gate would then skip scheduling forever — the observer
  // silently dead. Clear-and-reschedule is robust to that, and bursts
  // still coalesce into a single check (idempotent ensure makes extra
  // checks harmless no-ops).
  _observer = new MutationObserver(() => {
    if (_observerTimer) clearTimeout(_observerTimer);
    _observerTimer = setTimeout(() => {
      _observerTimer = null;
      ensureAllEager();
    }, OBSERVER_DEBOUNCE_MS);
  });
  _observer.observe(getObserverRoot(), {
    childList: true,
    subtree: true,
  });

  // bfcache restore (persisted): normally the full DOM survives, but
  // partially-replaced DOM under bfcache is an edge case; check
  // immediately (no debounce).
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) ensureAllEager();
  });
}

/**
 * Register a persistent host. Returns the handle the component uses to
 * declare policy; the manager owns all mechanism.
 *
 *   const h = registerHost({ hostId, create, recovery })
 *
 *   h.enable()     — flag=true + ensure (create if missing) — the
 *                    "this host should exist" entry (translation init,
 *                    interaction entry points)
 *   h.disable()    — flag=false + remove every copy — the "should not
 *                    exist" entry (config off, page restore); also
 *                    blocks eager rebuilds ("hidden by choice")
 *   h.ensure()     — idempotent: enabled ∧ !healthy → clear + create
 *   h.rebuild()    — unconditional: flag=true + clear + create (fresh
 *                    instance) — the floatingBtn.show() semantics
 *   h.isEnabled()  — query (tests/debug)
 *
 * `recovery`: "eager" (manager subscribes popstate/observer/pageshow)
 * or "lazy" (component calls ensure()/enable() at interaction entries).
 * Hosts start disabled: before the first enable() no eager trigger may
 * create a host (the `!divElement` guard semantics of the original
 * observer code).
 *
 * @param {{hostId: string, create: Function, recovery: "eager"|"lazy"}} opts
 */
export function registerHost({ hostId, create, recovery }) {
  const record = { hostId, create, recovery, enabled: false };
  registry.set(hostId, record);
  if (recovery === "eager") installEagerSubscriptions();

  return {
    enable() {
      record.enabled = true;
      ensureRecord(record);
    },
    disable() {
      record.enabled = false;
      removeAllHostCopies(hostId);
    },
    ensure() {
      ensureRecord(record);
    },
    rebuild() {
      record.enabled = true;
      removeAllHostCopies(hostId);
      try {
        record.create();
      } catch (e) {
        console.warn(
          "[hostLifecycle] create() failed for " + hostId + " during rebuild",
          e
        );
      }
    },
    isEnabled() {
      return record.enabled;
    },
  };
}
