/**
 * Canary scenario library (S5, issue #57) — declarative data consumed by
 * scripts/real-site-verify.mjs (the executor).
 *
 * Each scenario is DATA, not code: the executor owns the step loop, the
 * tri-state assertions (healthy ∧ count===1 after every settled step) and
 * the diagnostics. Adding a scenario = adding one entry here.
 *
 * `source` is mandatory — it records where the scenario came from (user
 * report / incident id). This is the answer to the doc-13 finding that
 * diagnostic scripts died with their debugging session: user reports must
 * land in a permanent, traceable home.
 *
 * Step types (closed set, implemented by the executor):
 *   - goto      : navigate to url (waits for URL + host healthy);
 *                 `requireSameDocument: true` (plan 36) additionally asserts
 *                 the document survived the navigation (client-side route) —
 *                 a full page load reports SKIP-DATA (premise invalid)
 *   - translate : click the floating Google button and wait for
 *                 translation REALITY (quality gate) + host healthy
 *   - back      : history back (waits for URL + host healthy)
 *   - forward   : history forward (waits for URL + host healthy)
 *   - roundtrip : convenience — back/forward repeated `rounds` times;
 *                 `guardSameDocument: true` (plan 36) asserts every hop
 *                 stays in the same document and lands on the two
 *                 preceding goto paths — drift/full-load ⇒ SKIP-DATA
 *   - settle    : no-op wait for host healthy (explicit stabilization point)
 *   - seed-position : write {left,top} into floatingBtnPosition storage
 *                 BEFORE the following goto (#78 saved-position lock)
 *   - assert-floating-visible : floating layer must intersect the viewport
 *                 ∧ visiblePct ≥ 50 (user-visible #78 lock)
 *
 * Scope notes:
 *   - All scenarios are Google-only. The canary has no API key; AI paths
 *     are covered by the browser E2E suite. Deliberately NOT mocking AI
 *     here: a real-site canary that secretly runs mocks would poison the
 *     signal semantics doc 13 warns about.
 *   - Assertions are tri-state (absent/shell/healthy) — see
 *     tests/shared/host-state.mjs. Translation steps additionally run the
 *     translation-reality gate (nonEmpty floor ∧ CJK ratio — plan 34);
 *     the executor seeds targetLanguage=zh-CN for the run. Two measured
 *     false-green holes (429 window / en→en identity) are closed by it.
 *   - LOCAL_SCENARIOS (below; x.com) are NOT part of the CI matrix:
 *     their carrier sites are unreachable from GitHub Actions
 *     (Cloudflare blocks the runner IP range — plan 34 §二.3). They run
 *     locally via --include-local / --scenario=; a local cron may
 *     schedule them later (plan 34 Phase 2, pending 3 clean rounds).
 *
 * Self-test mapping (--self-test): step URLs are rewritten by
 * `host + pathname` (bare pathname fallback) against SELF_TEST_PATH_MAP
 * onto the local spa mock pages (extra/e2e/, served by the executor).
 * Unmapped scenarios report SKIP-DATA (never fall back to the real site
 * — the self-test contract is hermetic). Position scenarios are excluded
 * from self-test by the executor (real-site only).
 */

export const SELF_TEST_PATH_MAP = {
  "/obra/superpowers/projects": "spa-source.html",
  "/obra/superpowers/security": "spa-target.html",
  // Host-aware additions (plan 34 §三.C): keys are `host + pathname`
  // (bare pathname stays supported as a compatible fallback). The new
  // sites reuse the existing spa mock pages. Position scenarios
  // (seed-position step) are excluded by the executor — they stay
  // real-site only and report SKIP-DATA under --self-test.
  "round-resonance-5aa9.seigwen.workers.dev/": "spa-source.html",
  "vercel.com/": "spa-source.html",
  "nextjs.org/": "spa-source.html",
  "nuxt.com/": "spa-source.html",
  "svelte.dev/": "spa-source.html",
  "angular.dev/": "spa-source.html",
  "astro.build/": "spa-source.html",
  "gitlab.com/explore/projects/active": "spa-source.html",
  // Roundtrip P2 targets (plan 36) — the mock spa-target carries the Turbo
  // snapshot semantics; source→target client nav exercises the same
  // DOM-rebuild path the real routers do.
  "nextjs.org/docs": "spa-target.html",
  "nuxt.com/modules": "spa-target.html",
  "svelte.dev/docs": "spa-target.html",
  "angular.dev/tutorials": "spa-target.html",
  "vercel.com/about": "spa-target.html",
};

const P1 = "https://github.com/obra/superpowers/projects";
const P2 = "https://github.com/obra/superpowers/security";
const W1 = "https://round-resonance-5aa9.seigwen.workers.dev/";

export const SCENARIOS = [
  {
    name: "bug8-double-page-roundtrip",
    source: "user report 2026-09-14 (bug 8: /projects ↔ /security back/forward disappearance)",
    description:
      "Translate both pages, then hammer back/forward 12 rounds — every settled step must keep a healthy floating host (the original bug: Turbo snapshot shell survived all rebuild checks).",
    steps: [
      { type: "goto", url: P1 },
      { type: "translate" },
      { type: "goto", url: P2 },
      { type: "translate" },
      { type: "roundtrip", rounds: 12 },
      { type: "assert-translated" }, // plan 34: lock "translation still real after Turbo roundtrips"
    ],
  },
  {
    name: "bug7-single-page-backnav",
    source: "incident 7 (PR #30: Turbo replaces the <body> element on back-nav; observer died)",
    description:
      "Translate, SPA-navigate away, then back ×3 rounds — the dynamic-translation observer must survive the body replacement and the host must stay healthy.",
    steps: [
      { type: "goto", url: P1 },
      { type: "translate" },
      { type: "goto", url: P2 },
      { type: "back" },
      { type: "forward" },
      { type: "back" },
      { type: "forward" },
      { type: "back" },
      { type: "assert-translated" }, // plan 34: lock "translation still real after back-nav"
    ],
  },
  {
    name: "selfheal-injections",
    source: "issue #40 / issue #43 (S1 audit real-site findings: hover self-heal + duplicate convergence)",
    description:
      "On a translated page inject a Turbo snapshot shell (cloneNode without shadow root) and poke the hover path — it must self-heal; then inject a duplicate host and poke hover — it must converge back to exactly one healthy host.",
    steps: [
      { type: "goto", url: P1 },
      { type: "translate" },
      { type: "inject-shell-hover" },
      { type: "inject-duplicate-hover" },
    ],
  },
  {
    name: "workersdev-translate",
    source: "user report 2026-09-27 (issue #78: round-resonance-5aa9.seigwen.workers.dev)",
    description:
      "Translate the user-reported workers.dev page — the translation-reality gate must hold (nonEmpty floor ∧ CJK ratio; the site once produced 142 empty containers).",
    steps: [{ type: "goto", url: W1 }, { type: "translate" }],
  },
  {
    name: "workersdev-78-position",
    source: "issue #78 (floating button group invisible on workers.dev)",
    description:
      "Seed an off-screen saved floating position (5000,5000), load the page — the floating layer must clamp back into the viewport (intersects ∧ visiblePct ≥ 50).",
    steps: [
      { type: "seed-position", left: 5000, top: 5000 },
      { type: "goto", url: W1 },
      { type: "assert-floating-visible" },
    ],
  },
  {
    name: "vercel-translate",
    source: "user report 2026-09-27 (issue #78)",
    description: "Translate vercel.com (307 → 200 redirect) — translation-reality gate must hold.",
    steps: [{ type: "goto", url: "https://vercel.com/" }, { type: "translate" }],
  },
  {
    name: "vercel-78-position",
    source: "issue #78",
    description:
      "Seed an off-screen saved floating position (5000,5000), load vercel.com — the floating layer must clamp back into the viewport.",
    steps: [
      { type: "seed-position", left: 5000, top: 5000 },
      { type: "goto", url: "https://vercel.com/" },
      { type: "assert-floating-visible" },
    ],
  },
  {
    name: "health-nextjs",
    source: "plan 34 recon (CI matrix run 36602259652: 274 non-empty / 94% CJK)",
    description: "Translate nextjs.org (SSR + React hydration representative) — translation-reality gate must hold.",
    steps: [{ type: "goto", url: "https://nextjs.org/" }, { type: "translate" }],
  },
  {
    name: "health-nuxt",
    source: "plan 34 recon (CI matrix run 36602259652: 272 non-empty / 85% CJK)",
    description: "Translate nuxt.com (Vue 3 + Nitro SSR representative) — translation-reality gate must hold.",
    steps: [{ type: "goto", url: "https://nuxt.com/" }, { type: "translate" }],
  },
  {
    name: "health-svelte",
    source: "plan 34 recon (CI matrix run 36602259652: 124 non-empty / 98% CJK)",
    description: "Translate svelte.dev (SvelteKit representative) — translation-reality gate must hold.",
    steps: [{ type: "goto", url: "https://svelte.dev/" }, { type: "translate" }],
  },
  {
    name: "health-angular",
    source: "plan 34 recon (CI matrix run 36602259652: 85 non-empty / 96% CJK)",
    description: "Translate angular.dev (Angular standalone representative) — translation-reality gate must hold.",
    steps: [{ type: "goto", url: "https://angular.dev/" }, { type: "translate" }],
  },
  {
    name: "health-astro",
    source: "plan 34 recon (CI matrix run 36602259652: 258 non-empty / 94% CJK)",
    description: "Translate astro.build (islands architecture representative) — translation-reality gate must hold.",
    steps: [{ type: "goto", url: "https://astro.build/" }, { type: "translate" }],
  },
  {
    name: "health-gitlab",
    source: "plan 34 recon (CI matrix run 36602259652: 247 non-empty / 66% CJK — the thin-margin site)",
    description:
      "Translate gitlab.com/explore/projects/active (real SPA application representative) — translation-reality gate must hold. The FINAL URL is used deliberately: /explore client-redirects to /explore/projects/active (measured <1.1s in a real browser), so a waitForPath on /explore can never settle (calibration run 36659013595 caught this).",
    steps: [{ type: "goto", url: "https://gitlab.com/explore/projects/active" }, { type: "translate" }],
  },
  // ── Client-route roundtrips (plan 36, user request 2026-09-30) ──
  // Same-document routing measured on all five sites (probe archive
  // 2026-09-30: token/timeOrigin constant + per-hop popstate + stable
  // landings). astro / gitlab / workers.dev were excluded with evidence
  // (full-page navigations / no in-page links). `quality.visibleOnly`
  // excludes stale hidden route DOM (measured count inflation) from the
  // gate; `requireSameDocument` / `guardSameDocument` turn a rendering-mode
  // change into SKIP-DATA instead of a silent shallow test.
  {
    name: "roundtrip-nextjs",
    source: "user request 2026-09-30 (client-route roundtrip; probe route3-a)",
    description:
      "Translate the nextjs.org home, client-route to /docs (same-document guarded), translate, then 6× back/forward — the router rebuilds the DOM each hop; host must stay healthy and the VISIBLE translation must stay real.",
    quality: { visibleOnly: true },
    steps: [
      { type: "goto", url: "https://nextjs.org/" },
      { type: "translate" },
      { type: "goto", url: "https://nextjs.org/docs", requireSameDocument: true },
      { type: "translate" },
      { type: "roundtrip", rounds: 6, guardSameDocument: true },
      { type: "assert-translated" },
    ],
  },
  {
    name: "roundtrip-nuxt",
    source: "user request 2026-09-30 (client-route roundtrip; probe route3-a)",
    description:
      "Translate the nuxt.com home, client-route to /modules (same-document guarded; /docs/4.x client-redirects — the stable final URL is used directly), translate, then 6× back/forward.",
    quality: { visibleOnly: true },
    steps: [
      { type: "goto", url: "https://nuxt.com/" },
      { type: "translate" },
      { type: "goto", url: "https://nuxt.com/modules", requireSameDocument: true },
      { type: "translate" },
      { type: "roundtrip", rounds: 6, guardSameDocument: true },
      { type: "assert-translated" },
    ],
  },
  {
    name: "roundtrip-svelte",
    source: "user request 2026-09-30 (client-route roundtrip; probe route3-a)",
    description:
      "Translate the svelte.dev home, client-route to /docs (same-document guarded), translate, then 6× back/forward.",
    quality: { visibleOnly: true },
    steps: [
      { type: "goto", url: "https://svelte.dev/" },
      { type: "translate" },
      { type: "goto", url: "https://svelte.dev/docs", requireSameDocument: true },
      { type: "translate" },
      { type: "roundtrip", rounds: 6, guardSameDocument: true },
      { type: "assert-translated" },
    ],
  },
  {
    name: "roundtrip-angular",
    source: "user request 2026-09-30 (client-route roundtrip; probe route3-a)",
    description:
      "Translate the angular.dev home, client-route to /tutorials (same-document guarded; /docs client-redirects to /overview — /tutorials is the stable target), translate, then 6× back/forward.",
    quality: { visibleOnly: true },
    steps: [
      { type: "goto", url: "https://angular.dev/" },
      { type: "translate" },
      { type: "goto", url: "https://angular.dev/tutorials", requireSameDocument: true },
      { type: "translate" },
      { type: "roundtrip", rounds: 6, guardSameDocument: true },
      { type: "assert-translated" },
    ],
  },
  {
    name: "roundtrip-vercel",
    source: "user request 2026-09-30 (client-route roundtrip; probe route3-b)",
    description:
      "Translate the vercel.com home, client-route to /about (same-document guarded; /docs is a full page load — /about is the client-route target), translate, then 6× back/forward.",
    quality: { visibleOnly: true },
    steps: [
      { type: "goto", url: "https://vercel.com/" },
      { type: "translate" },
      { type: "goto", url: "https://vercel.com/about", requireSameDocument: true },
      { type: "translate" },
      { type: "roundtrip", rounds: 6, guardSameDocument: true },
      { type: "assert-translated" },
    ],
  },
];

/**
 * Local-only layer (plan 34 §三.D / Q1): carrier sites unreachable from
 * GitHub Actions (Cloudflare IP-reputation block). Default library runs
 * skip these; use --include-local or name one with --scenario=.
 */
export const LOCAL_SCENARIOS = [
  {
    name: "xcom-health",
    source: "issue #98 carrier site / plan 34 Q1 (local layer)",
    description:
      "Translate the x.com profile feed — translation-reality gate with default thresholds (recon dryrun baseline: 85 CJK / 179 count ≈ 47%; revisit thresholds if calibration runs come in borderline).",
    steps: [{ type: "goto", url: "https://x.com/elonmusk" }, { type: "translate" }],
  },
];
