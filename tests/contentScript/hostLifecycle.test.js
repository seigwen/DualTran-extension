/**
 * hostLifecycle.test.js — HostLifecycleManager unit tests (C1, M5).
 *
 * Q7 cells (18-c1-host-lifecycle-manager-plan.md):
 *   ① registration/handle — default disabled, isEnabled() false
 *   ② enable/disable — disable clears EVERY copy + flag=false
 *   ③ ensure idempotence — healthy no-rebuild, missing/degraded → count===1
 *   ④ rebuild unconditional — healthy host replaced too
 *   ⑤ disabled negative — popstate/observer/pageshow must NOT rebuild
 *   ⑥ eager timing fidelity — popstate 200ms / observer 300ms debounce /
 *      pageshow immediate (millisecond-aligned; numbers encode the
 *      bug 7 / bug 8 lessons — see hostLifecycle.js header)
 *   ⑦ create() throw resilience — caught + logged, subscription stays alive
 *   ⑧ third-host acceptance — one registerHost() call grants predicate +
 *      eager subscription + duplicate convergence + disable blocking (M5)
 *   ⑨ predicate semantics — absent/healthy/shell/detached/duplicate
 *
 * Implementation points covered (rule symmetry): `hostLifecycle.js`
 * `registerHost`, `hasFunctionalHost`, `ensure`, `rebuild`, `disable`,
 * `enable`, `installEagerSubscriptions`.
 *
 * Design note: one module instance shared by the whole file (the real
 * content-script semantics — the module loads once). Test isolation is
 * achieved with unique per-test host ids, NOT vi.resetModules(), because
 * resetModules would leave the previous instance's eager window/document
 * listeners alive and dispatching into both instances.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { registerHost, hasFunctionalHost } from "../../src/contentScript/hostLifecycle.js";

// ── Helpers ──────────────────────────────────────────────────────

const TEST_ID_PREFIX = "dualtran-test-host-";
let seq = 0;

function nextHostId() {
  seq += 1;
  return TEST_ID_PREFIX + seq;
}

function getHost(hostId) {
  return document.getElementById(hostId);
}

function countHosts(hostId) {
  return document.querySelectorAll("#" + hostId).length;
}

/** Synthetic host factory: builds a real shadow-DOM host in document.body. */
function makeCreate(hostId, onCreate) {
  return function createSyntheticHost() {
    const host = document.createElement("div");
    host.id = hostId;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = '<button class="probe-btn">P</button>';
    document.body.appendChild(host);
    if (onCreate) onCreate();
  };
}

/** Turbo-snapshot flavor: a shadow-less shell copy under the same id. */
function injectShell(hostId) {
  const shell = document.createElement("div");
  shell.id = hostId;
  document.body.appendChild(shell);
  return shell;
}

async function flushMicrotasks(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

function dispatchPopstate() {
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function dispatchPageshow(persisted) {
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted }));
}

// Registered handles created during a test (cleaned up in afterEach).
const activeHandles = [];

function register(hostId, opts = {}) {
  const handle = registerHost({
    hostId,
    create: opts.create || makeCreate(hostId),
    recovery: opts.recovery || "eager",
  });
  activeHandles.push(handle);
  return handle;
}

let attachShadowSpy;

beforeEach(() => {
  vi.useFakeTimers();
  attachShadowSpy = vi
    .spyOn(HTMLElement.prototype, "attachShadow")
    .mockImplementation(function attachShadow(init) {
      return Element.prototype.attachShadow.call(this, { ...init, mode: "open" });
    });
});

afterEach(() => {
  // Disable every handle this test created (flag=false → future eager
  // triggers no longer touch these hosts) and remove their DOM residue.
  while (activeHandles.length > 0) {
    try {
      activeHandles.pop().disable();
    } catch (_) {
      // defensive: cleanup must never throw
    }
  }
  document.querySelectorAll('[id^="' + TEST_ID_PREFIX + '"]').forEach((el) => el.remove());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── ① Registration / handle ──────────────────────────────────────

describe("① registration and handle", () => {
  it("a fresh registration is disabled and creates nothing", () => {
    const hostId = nextHostId();
    const handle = register(hostId);

    expect(handle.isEnabled()).toBe(false);
    expect(countHosts(hostId)).toBe(0);
  });

  it("eager registration while disabled: popstate must NOT create the host (the !divElement guard semantics)", async () => {
    const hostId = nextHostId();
    const handle = register(hostId, { recovery: "eager" });

    dispatchPopstate();
    vi.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(handle.isEnabled()).toBe(false);
    expect(countHosts(hostId)).toBe(0);
  });
});

// ── ② enable / disable ───────────────────────────────────────────

describe("② enable / disable", () => {
  it("enable() creates the host and flips the flag", () => {
    const hostId = nextHostId();
    const handle = register(hostId);

    handle.enable();

    expect(handle.isEnabled()).toBe(true);
    expect(countHosts(hostId)).toBe(1);
    expect(hasFunctionalHost(hostId)).toBe(true);
  });

  it("disable() clears EVERY copy (healthy + shell) and flips the flag", () => {
    const hostId = nextHostId();
    const handle = register(hostId);

    handle.enable();
    injectShell(hostId); // duplicate: healthy + shadow-less shell
    expect(countHosts(hostId)).toBe(2);

    handle.disable();

    expect(handle.isEnabled()).toBe(false);
    expect(countHosts(hostId)).toBe(0);
  });
});

// ── ③ ensure idempotence ─────────────────────────────────────────

describe("③ ensure idempotence", () => {
  it("ensure() on a healthy host is a no-op (same instance kept)", () => {
    const hostId = nextHostId();
    const handle = register(hostId);
    handle.enable();
    const original = getHost(hostId);

    handle.ensure();

    expect(getHost(hostId)).toBe(original);
    expect(countHosts(hostId)).toBe(1);
  });

  it("ensure() on a missing host recreates to count===1", () => {
    const hostId = nextHostId();
    const handle = register(hostId);
    handle.enable();
    getHost(hostId).remove();
    expect(countHosts(hostId)).toBe(0);

    handle.ensure();

    expect(countHosts(hostId)).toBe(1);
    expect(hasFunctionalHost(hostId)).toBe(true);
  });

  it("ensure() on a shell converges: shell cleared, single healthy host", () => {
    const hostId = nextHostId();
    const handle = register(hostId);
    handle.enable();
    getHost(hostId).remove();
    const shell = injectShell(hostId);
    expect(countHosts(hostId)).toBe(1);

    handle.ensure();

    expect(countHosts(hostId)).toBe(1);
    const host = getHost(hostId);
    expect(host).not.toBe(shell);
    expect(host.shadowRoot).not.toBeNull();
  });

  it("ensure() on a duplicate converges to a single healthy host", () => {
    const hostId = nextHostId();
    const handle = register(hostId);
    handle.enable();
    injectShell(hostId);
    expect(countHosts(hostId)).toBe(2);

    handle.ensure();

    expect(countHosts(hostId)).toBe(1);
    expect(hasFunctionalHost(hostId)).toBe(true);
  });
});

// ── ④ rebuild unconditional ──────────────────────────────────────

describe("④ rebuild", () => {
  it("rebuild() replaces even a healthy host (fresh instance)", () => {
    const hostId = nextHostId();
    const handle = register(hostId);
    handle.enable();
    const original = getHost(hostId);

    handle.rebuild();

    const replacement = getHost(hostId);
    expect(replacement).not.toBe(original);
    expect(countHosts(hostId)).toBe(1);
    expect(handle.isEnabled()).toBe(true);
  });

  it("rebuild() works from a disabled state (flag is set by rebuild — the floatingBtn.show() semantics)", () => {
    const hostId = nextHostId();
    const handle = register(hostId);
    expect(handle.isEnabled()).toBe(false);

    handle.rebuild();

    expect(handle.isEnabled()).toBe(true);
    expect(countHosts(hostId)).toBe(1);
  });
});

// ── ⑤ disabled negative ──────────────────────────────────────────

describe("⑤ disabled hosts ignore every eager trigger", () => {
  it("disable() blocks popstate / observer / pageshow rebuilds", async () => {
    const hostId = nextHostId();
    const handle = register(hostId, { recovery: "eager" });
    handle.enable();
    handle.disable();
    expect(countHosts(hostId)).toBe(0);

    // popstate
    dispatchPopstate();
    vi.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(countHosts(hostId)).toBe(0);

    // observer (DOM mutations)
    document.body.appendChild(document.createElement("p"));
    await flushMicrotasks();
    vi.advanceTimersByTime(350);
    await flushMicrotasks();
    expect(countHosts(hostId)).toBe(0);

    // pageshow persisted
    dispatchPageshow(true);
    await flushMicrotasks();
    expect(countHosts(hostId)).toBe(0);
  });
});

// ── ⑥ eager timing fidelity ──────────────────────────────────────

describe("⑥ eager timing fidelity (200ms / 300ms / immediate)", () => {
  it("popstate rebuilds after exactly 200ms, not before", async () => {
    const hostId = nextHostId();
    const handle = register(hostId, { recovery: "eager" });
    handle.enable();
    getHost(hostId).remove();

    dispatchPopstate();
    await flushMicrotasks();
    vi.advanceTimersByTime(199);
    await flushMicrotasks();
    expect(countHosts(hostId)).toBe(0); // 199ms: not yet

    vi.advanceTimersByTime(1);
    await flushMicrotasks();
    expect(countHosts(hostId)).toBe(1); // 200ms: rebuilt
  });

  it("observer rebuilds 300ms after the last observed mutation (clear+reschedule debounce)", async () => {
    const hostId = nextHostId();
    const handle = register(hostId, { recovery: "eager" });
    handle.enable();
    getHost(hostId).remove(); // mutation #1
    await flushMicrotasks();

    vi.advanceTimersByTime(150);
    document.body.appendChild(document.createElement("p")); // mutation #2 resets the debounce
    await flushMicrotasks();

    // 300ms after mutation #1, but only 150ms after mutation #2 → no rebuild yet.
    vi.advanceTimersByTime(150);
    await flushMicrotasks();
    expect(countHosts(hostId)).toBe(0);

    // 300ms after the LAST mutation → rebuild.
    vi.advanceTimersByTime(150);
    await flushMicrotasks();
    expect(countHosts(hostId)).toBe(1);
  });

  it("pageshow(persisted=true) rebuilds immediately (no debounce)", async () => {
    const hostId = nextHostId();
    const handle = register(hostId, { recovery: "eager" });
    handle.enable();
    getHost(hostId).remove();

    dispatchPageshow(true);
    await flushMicrotasks();

    // No timer advancement — the check is immediate.
    expect(countHosts(hostId)).toBe(1);
  });

  it("pageshow(persisted=false) does NOT rebuild", async () => {
    const hostId = nextHostId();
    const handle = register(hostId, { recovery: "eager" });
    handle.enable();
    getHost(hostId).remove();
    await flushMicrotasks(); // observer mutation registered (300ms timer pending)

    dispatchPageshow(false);
    await flushMicrotasks();
    expect(countHosts(hostId)).toBe(0); // non-persisted path is a no-op
  });

  it("repeated popstate bursts rebuild once (debounce coalescing)", async () => {
    const hostId = nextHostId();
    const creates = { count: 0 };
    const handle = register(hostId, {
      recovery: "eager",
      create: makeCreate(hostId, () => { creates.count += 1; }),
    });
    handle.enable();
    const initial = creates.count; // 1 from enable()
    getHost(hostId).remove();

    dispatchPopstate();
    dispatchPopstate();
    dispatchPopstate();
    vi.advanceTimersByTime(250);
    await flushMicrotasks();

    // Three bursts → a single coalesced check → exactly one rebuild.
    expect(creates.count).toBe(initial + 1);
    expect(countHosts(hostId)).toBe(1);
  });

  it("a healthy host is not rebuilt by eager triggers (idempotent ensure, no ghost rebuild)", async () => {
    const hostId = nextHostId();
    const handle = register(hostId, { recovery: "eager" });
    handle.enable();
    const original = getHost(hostId);

    dispatchPopstate();
    vi.advanceTimersByTime(250);
    document.body.appendChild(document.createElement("p"));
    await flushMicrotasks();
    vi.advanceTimersByTime(350);
    dispatchPageshow(true);
    await flushMicrotasks();

    expect(getHost(hostId)).toBe(original); // same instance throughout
  });
});

// ── ⑦ create() throw resilience ──────────────────────────────────

describe("⑦ create() throw resilience", () => {
  it("a throwing create() is caught, logged, and the subscription stays alive", async () => {
    const hostId = nextHostId();
    let createCalls = 0;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handle = register(hostId, {
      recovery: "eager",
      create: () => {
        createCalls += 1;
        throw new Error("boom");
      },
    });

    expect(() => handle.enable()).not.toThrow();
    expect(createCalls).toBe(1);
    expect(countHosts(hostId)).toBe(0);
    expect(warnSpy).toHaveBeenCalled();

    // The eager subscription must still fire and attempt another create —
    // the old disconnect→show→re-observe dance could die here permanently.
    dispatchPopstate();
    vi.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(createCalls).toBe(2);
    expect(warnSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// ── ⑧ third-host acceptance (M5 ruler) ──────────────────────────

describe("⑧ third persistent host — one registerHost() call grants everything (M5 acceptance)", () => {
  it("predicate + eager subscription + duplicate convergence + disable blocking, out of the box", async () => {
    const hostId = nextHostId();

    // ── The acceptance ruler: ONE registration call. ──
    const handle = register(hostId, { recovery: "eager" });

    // 1) Predicate applies automatically.
    expect(hasFunctionalHost(hostId)).toBe(false);

    // 2) enable() creates; predicate turns true.
    handle.enable();
    expect(hasFunctionalHost(hostId)).toBe(true);

    // 3) Eager subscription applies automatically: popstate rebuild.
    getHost(hostId).remove();
    dispatchPopstate();
    vi.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(hasFunctionalHost(hostId)).toBe(true);

    // 4) Duplicate convergence applies automatically.
    injectShell(hostId);
    expect(countHosts(hostId)).toBe(2);
    dispatchPopstate();
    vi.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(countHosts(hostId)).toBe(1);
    expect(hasFunctionalHost(hostId)).toBe(true);

    // 5) disable() blocking applies automatically.
    handle.disable();
    expect(countHosts(hostId)).toBe(0);
    dispatchPopstate();
    vi.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(countHosts(hostId)).toBe(0);
  });

  it("a lazy third host gets everything except the eager subscription", async () => {
    const hostId = nextHostId();
    const handle = register(hostId, { recovery: "lazy" });

    handle.enable();
    getHost(hostId).remove();

    // No eager rebuild: the host stays absent until an interaction entry
    // calls ensure()/enable() (the lazy contract).
    dispatchPopstate();
    vi.advanceTimersByTime(250);
    await flushMicrotasks();
    expect(countHosts(hostId)).toBe(0);

    // The interaction entry point self-heals on demand.
    handle.ensure();
    expect(countHosts(hostId)).toBe(1);
  });
});

// ── ⑨ predicate semantics ────────────────────────────────────────

describe("⑨ hasFunctionalHost predicate semantics", () => {
  it("absent → false", () => {
    const hostId = nextHostId();
    expect(hasFunctionalHost(hostId)).toBe(false);
  });

  it("healthy (connected + shadowRoot + count===1) → true", () => {
    const hostId = nextHostId();
    const handle = register(hostId);
    handle.enable();

    expect(hasFunctionalHost(hostId)).toBe(true);
  });

  it("shell (no shadowRoot) → false", () => {
    const hostId = nextHostId();
    injectShell(hostId);

    expect(hasFunctionalHost(hostId)).toBe(false);
  });

  it("detached (removed from the DOM) → false", () => {
    const hostId = nextHostId();
    const handle = register(hostId);
    handle.enable();
    getHost(hostId).remove();

    expect(hasFunctionalHost(hostId)).toBe(false);
  });

  it("duplicate (even healthy + shell) → false — any count != 1 rebuilds", () => {
    const hostId = nextHostId();
    const handle = register(hostId);
    handle.enable();
    injectShell(hostId);

    expect(hasFunctionalHost(hostId)).toBe(false);
  });

  it("the predicate is a pure query — it creates/removes nothing", () => {
    const hostId = nextHostId();
    const handle = register(hostId);
    handle.enable();
    const host = getHost(hostId);

    hasFunctionalHost(hostId);
    hasFunctionalHost(hostId);

    expect(getHost(hostId)).toBe(host);
    expect(countHosts(hostId)).toBe(1);
  });
});
