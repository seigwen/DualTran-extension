/**
 * Shared host-state primitives (S5, issue #57) — single source
 * of truth for the tri-state host classifier and failure-state injector.
 *
 * Before this module the classifier existed in three copies (setup.mjs,
 * navigation-recovery.mjs Scene 6, real-site-verify.mjs). S4 removed the
 * E2E-local copies and migrated every scenario onto setup.mjs; S5 removes
 * the last tool-layer copy by extracting the browser-context primitives
 * here, imported by BOTH tests/browser-e2e/setup.mjs and
 * scripts/real-site-verify.mjs (the canary executor).
 *
 * Design constraints:
 *   - These functions run INSIDE the browser via page.evaluate — they
 *     must be fully self-contained (no module-scope closures), because
 *     Playwright serializes the function source.
 *   - Node-side wrappers stay where they are: setup.mjs keeps its
 *     readHostState / injectHostState / assertHostState / waitForHostState
 *     signatures unchanged; the canary executor keeps its own thin
 *     Node-side helpers. This module is the shared BROWSER layer only.
 *
 * Tri-state semantics:
 *   - absent  : no host element at all.
 *   - shell   : host present but NO shadowRoot — a Turbo snapshot
 *               cloneNode artifact (cloneNode does not clone shadow roots).
 *   - healthy : host with shadowRoot.
 *
 * @module host-state
 */

/** Component name → host element id. */
export const HOST_SELECTORS = {
  floating: "dualtran-floating-btn-host",
  singleton: "dualtran-singleton-btn-host",
};

/**
 * Resolve a component name to its host element id.
 * Unknown component names fall back to "singleton" (matches the original
 * setup.mjs ternary, preserved for exact behavioral compatibility).
 *
 * @param {"floating"|"singleton"} component
 * @returns {string}
 */
export function hostSelectorFor(component) {
  return component === "floating" ? HOST_SELECTORS.floating : HOST_SELECTORS.singleton;
}

/**
 * Browser-context classifier: read the tri-state classification of a host.
 * Pass to page.evaluate with the host id as the argument:
 *
 *   page.evaluate(classifyHostStateInPage, "dualtran-floating-btn-host")
 *
 * `hasButtons` is component-aware readiness: floating needs
 * btnOriginal/btnGoogle/btnAi inside the shadow root; singleton needs
 * `.dualtran-btn-group`.
 *
 * @param {string} id host element id
 * @returns {{count: number, state: "absent"|"shell"|"healthy", hasButtons: boolean, hostFound: boolean}}
 */
export function classifyHostStateInPage(id) {
  const hosts = [...document.querySelectorAll(`#${id}`)];
  const host = hosts[0] || null;
  const root = host?.shadowRoot || null;
  let hasButtons = false;
  if (root) {
    if (id === "dualtran-floating-btn-host") {
      hasButtons = !!(root.getElementById("btnOriginal") && root.getElementById("btnGoogle") && root.getElementById("btnAi"));
    } else {
      hasButtons = !!root.querySelector(".dualtran-btn-group");
    }
  }
  return {
    count: hosts.length,
    state: !host ? "absent" : root ? "healthy" : "shell",
    hasButtons,
    hostFound: !!host,
  };
}

/**
 * Browser-context failure-state injector. Pass to page.evaluate with the
 * options object as the argument:
 *
 *   page.evaluate(injectHostStateInPage, { id, state: "shell", order: "healthy-first" })
 *
 * Injection semantics (DOM shape, from the 8th bug diagnosis):
 *   - absent    : remove every host copy.
 *   - detached  : remove the host (DOM-identical to absent — the handle
 *                 difference, null vs stale JS reference, cannot be
 *                 injected from the page; that dimension lives in the
 *                 jsdom unit layer by design).
 *   - shell     : cloneNode(true) replaceWith — real Turbo snapshot
 *                 semantics (shadow root is NOT cloned). Do NOT use
 *                 remove+recreate: the missing shadowRoot is the very
 *                 thing that makes a shell pass existence checks.
 *   - duplicate : cloneNode(true) append after the healthy host
 *                 (healthy-first; the flavor that used to survive
 *                 indefinitely), or before it with order="shell-first".
 *
 * Returns the post-injection classification (count + state).
 *
 * @param {{id: string, state: "absent"|"detached"|"shell"|"duplicate", order?: "healthy-first"|"shell-first"}} opts
 * @returns {{count: number, state: "absent"|"shell"|"healthy"}}
 */
export function injectHostStateInPage({ id, state, order }) {
  const hosts = [...document.querySelectorAll(`#${id}`)];
  const healthyHost = hosts.find((h) => h.shadowRoot) || hosts[0] || null;

  const classify = () => {
    const now = [...document.querySelectorAll(`#${id}`)];
    const host = now[0] || null;
    const root = host?.shadowRoot || null;
    return { count: now.length, state: !host ? "absent" : root ? "healthy" : "shell" };
  };

  if (state === "absent" || state === "detached") {
    hosts.forEach((el) => el.remove());
    return classify();
  }

  if (!healthyHost) {
    throw new Error(`[injectHostState] cannot inject "${state}" for #${id}: no host present (inject on a healthy page)`);
  }

  if (state === "shell") {
    const shell = healthyHost.cloneNode(true);
    healthyHost.replaceWith(shell);
    return classify();
  }

  if (state === "duplicate") {
    const copy = healthyHost.cloneNode(true);
    if (order === "shell-first") {
      healthyHost.parentNode.insertBefore(copy, healthyHost);
    } else {
      healthyHost.parentNode.appendChild(copy);
    }
    return classify();
  }

  throw new Error(`[injectHostState] unknown state "${state}"`);
}
