/**
 * Announcement-channel SSOT (plan 40 / #137 — highlight-desync family closure,
 * part B).
 *
 * ── Why this exists ──
 *
 * The "page translated but the button highlight is wrong" family has now
 * recurred four times (pattern 25/#23, pattern 28/#29, pattern 46/#70,
 * pattern 61/#134). #134's root cause was a CHANNEL problem: an internal
 * transition (`restorePage(silent=true)`) suppressed its intent event but
 * leaked on two OTHER channels (observer broadcast + SW message), and the
 * observer subscriber executed user-level restore semantics on the leaked
 * announcement. Part A (#137) removed that mechanism (single outlet +
 * mirror-only subscriber); this SSOT is the enforcement arm that keeps the
 * property from silently eroding:
 *
 *   - every announcement channel is ENUMERATED here (id / emitter / suppress
 *     mechanism / consumers / consumer role / probe refs);
 *   - `check-announcement-channels.js` (15th architecture lint) enforces
 *     outlet uniqueness (A1), probe presence (A2), navigation-scenario
 *     highlight assertions (A3), and mirror-only subscriber regions (A4)
 *     against this list — a new channel cannot stay silently untested, and a
 *     semantic write cannot silently reappear in a mirror-only region.
 *
 * Field contract (enforced by the lint):
 *   id            — lowercase-dash, unique
 *   kind          — "announcement" | "intent" | "render" | "storage"
 *   emitter       — production function that emits the channel
 *   suppress      — how internal/silent operations suppress this channel
 *   consumers     — UI/src consumers (names)
 *   consumerRole  — "mirror-only" (may mirror + render, never semantic) |
 *                   "semantic" (owned by the intent channel) | "none"
 *   probeRefs     — test files pinning this channel's behavior
 *   probeTokens   — tokens that must appear (decommented) in >=1 probeRef
 *   probeRequired — true/false; MUST be declared explicitly. false requires a
 *                   written probeExempt reason (typed exemption, #98 pattern)
 *   provenance    — REQUIRED: issue number or capture date
 */

export const ANNOUNCEMENT_CHANNELS = [
  {
    id: "page-language-observers",
    kind: "announcement",
    emitter: "announcePageLanguageState",
    suppress: "funnel-silent-flag",
    consumers: ["floatingBtn", "popupMobile", "showTranslated"],
    consumerRole: "mirror-only",
    probeRefs: [
      "pageTranslator.navRestore.integration.test.js",
      "floatingBtn.behavior.test.js",
    ],
    probeTokens: ["onPageLanguageStateChange"],
    probeRequired: true,
    provenance:
      "#134 (2026-10-02 silent leak on the observer channel) / #137 plan 40 part A",
  },
  {
    id: "sw-set-page-language-state",
    kind: "announcement",
    emitter: "announcePageLanguageState",
    suppress: "funnel-silent-flag",
    consumers: ["sw.js updateContextMenu", "autoTranslateLinkHelpers", "iconHelpers"],
    consumerRole: "none",
    probeRefs: ["pageTranslator.navRestore.integration.test.js"],
    probeTokens: ["setPageLanguageState"],
    probeRequired: true,
    provenance:
      "#134 (2026-10-02 silent leak on the SW message channel) / #137 plan 40 part A",
  },
  {
    id: "intent-requested-mode",
    kind: "intent",
    emitter: "emitRequestedModeChange",
    suppress: "silent-gate",
    consumers: ["floatingBtn"],
    consumerRole: "semantic",
    probeRefs: [
      "floatingBtn.behavior.test.js",
      "pageTranslator.navRestore.integration.test.js",
    ],
    probeTokens: ["emitRequestedModeChange", "onRequestedModeChange"],
    probeRequired: true,
    provenance: "plan 30 / #102 (intent-event model) — E1/E2/E3 announcement points",
  },
  {
    id: "page-render-state",
    kind: "render",
    emitter: "setPageRenderState",
    suppress: "change-guard",
    consumers: ["floatingBtn"],
    consumerRole: "mirror-only",
    probeRefs: [
      "floatingBtn.behavior.test.js",
      "pageTranslator.navRestore.integration.test.js",
    ],
    probeTokens: ["emitPageRenderStateChange"],
    probeRequired: true,
    provenance: "plan 30 / #102 (displayMode actual-display record ownership)",
  },
  {
    id: "ai-render-state",
    kind: "render",
    emitter: "setAiRenderState",
    suppress: "change-guard",
    consumers: ["floatingBtn"],
    consumerRole: "mirror-only",
    probeRefs: [
      "floatingBtn.behavior.test.js",
      "pageTranslator.navRestore.integration.test.js",
    ],
    probeTokens: ["emitAiRenderStateChange"],
    probeRequired: true,
    provenance:
      "plan 30 / #102 (AI flow state: loading/success/error drives intent derivation)",
  },
  {
    id: "ai-applied-marker",
    kind: "storage",
    emitter: "saveAiAppliedFlag",
    suppress: "n/a (read-gated at consumers)",
    consumers: ["pageTranslator (pageshow restore)"],
    consumerRole: "none",
    probeRefs: ["pageTranslator.navRestore.integration.test.js"],
    probeTokens: ["aiApplied"],
    probeRequired: true,
    provenance:
      "#29 (2026-09-06 refresh-restore path) / plan 30 (armed-marker discipline)",
  },
];

/** Channels whose behavior must be pinned by probes (lint A2). */
export const PROBE_REQUIRED_CHANNEL_IDS = Object.freeze(
  ANNOUNCEMENT_CHANNELS.filter((c) => c.probeRequired).map((c) => c.id)
);

/** The single announcement outlet that MUST contain all pageLanguageState emits (lint A1). */
export const ANNOUNCEMENT_OUTLET = Object.freeze({
  file: "src/contentScript/pageTranslator.js",
  functionName: "announcePageLanguageState",
  forbiddenRawTokens: [
    "pageLanguageStateObservers.forEach",
    'action: "setPageLanguageState"',
  ],
});

/** The mirror-only region contract (lint A4). */
export const MIRROR_ONLY_CONTRACT = Object.freeze({
  file: "src/contentScript/floatingBtn.js",
  beginMarker: "[mirror-only:begin]",
  endMarker: "[mirror-only:end]",
  forbiddenTokens: [
    "setAiModeActive",
    "setHighlight(",
    "propagateIntentToBlocks",
    "intervention",
    "displayMode",
    "googleInFlight",
    "aiInFlight",
  ],
});

/** Navigation scenarios must assert the highlight + SSOT (lint A3). */
export const NAV_ASSERT_CONTRACT = Object.freeze({
  highlightReadTokens: [
    "dualtran-floating-btn-active",
    "getFloatingBtnHighlight",
    "getButtonHighlights",
    "getSingletonBtnHighlight",
  ],
  ssotToken: "assertUiStateMatchesEngine",
  exemptionMarker: "// nav-assert-allow:",
});
