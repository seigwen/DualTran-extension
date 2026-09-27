/**
 * Content-update channel SSOT (issue #98 follow-up — "Show more" family).
 *
 * ── Why this exists ──
 *
 * Twice now (issue #7 @2026-08-17, issue #98 @2026-09-26) the SAME user-visible
 * defect family escaped the whole test system: "content the site updates or
 * reveals AFTER the initial translation is not re-translated". Both times the
 * only E2E scenario covering the area simulated ONE mechanism (a childList
 * append), while the real site used a different one (characterData rewrite /
 * childList replace). A scenario whose NAME matches the symptom ("showmore")
 * creates a false sense of coverage — the risk budget is absorbed by a test
 * that exercises the wrong mechanism.
 *
 * This file is the missing classification: every way a page can change content
 * after translation is a CHANNEL, and every channel is either
 *   - active: simulated in a mock page, run by the conformance scenario in
 *     BOTH display modes, and unit-covered, or
 *   - exempt: physically unreachable / out of scope, with a written reason and
 *     an upstream-impact assessment.
 *
 * `check-content-update-channels.mjs` (CI lint) enforces the invariants
 * N1–N6 between this SSOT, the mock-page MOCK FIDELITY declarations, the E2E
 * scenario and the unit tests. A new channel cannot stay silently untested,
 * and a channel cannot silently drop out of the suite either.
 *
 * Field contract (enforced by the lint):
 *   id          — lowercase-dash, unique; appears in mock pages and scenario output
 *   mechanism   — one-line description of the DOM-level change
 *   provenance  — REQUIRED: issue number (#7, #98) or capture date (YYYY-MM-DD).
 *                 Prevents invented mechanisms; every channel must trace to an
 *                 incident, a live capture, or a dated design audit.
 *   status      — "active" | "exempt"
 *   kind        — "text" | "attribute" | "negative" (consumed by the conformance scenario)
 *   simulator   — how the mock page triggers this channel + what to measure
 *   scenarioRefs— E2E scenario files that exercise this channel (must exist and
 *                 contain behavioral mode iteration: forEachDisplayMode/DISPLAY_MODES)
 *   unitRefs    — jsdom test files covering the channel (must exist), OR
 *                 unitRefsExempt with a reason
 *   canary      — real-site coverage decision (status + reason); not every
 *                 channel needs a canary, but the decision must be recorded
 *   exemption   — (exempt only) { reason, upstreamImpact }
 */

/** All display modes a channel must be conformance-tested in (E2E). */
export const CHANNEL_DISPLAY_MODES = Object.freeze(["newLine", "replaceOriginal"]);

export const CONTENT_UPDATE_CHANNELS = [
  {
    id: "childlist-append",
    mechanism:
      "Site appends a new text-bearing node into an existing container (lazy load).",
    provenance: "#7 (2026-08-17 lazily-loaded content not translated after show-more reveal)",
    status: "active",
    kind: "text",
    simulator: {
      page: "test-page.html",
      section: "#showmore-article",
      container: "#showmore-container",
      source: "#showmore-hidden",
      trigger: "#showmore-btn",
    },
    scenarioRefs: ["content-update-conformance.mjs"],
    unitRefs: ["pageTranslator.integration.test.js"],
    canary: {
      status: "not-covered",
      reason: "Mechanism is DOM-generic; hermetic suite covers it. No real site has a stable anonymous repro (x.com is 403/login-walled).",
    },
  },
  {
    id: "childlist-replace",
    mechanism:
      "Site removes the truncated node and inserts a new node with the full text (x.com x-web client, captured live).",
    provenance: "#98 (2026-09-26 live x.com mutation capture; also scenario C of the #98 probe matrix)",
    status: "active",
    kind: "text",
    simulator: {
      page: "test-page.html",
      section: "#showmore-replace-article",
      container: "#showmore-replace-container",
      source: "#showmore-replace-visible",
      trigger: "#showmore-replace-btn",
    },
    scenarioRefs: ["content-update-conformance.mjs"],
    unitRefs: ["contentUpdateChannels.test.js"],
    canary: {
      status: "not-covered",
      reason: "Covered by the hermetic suite; real x.com is only reachable with a client-hints disguise and is rate-limited/logged-out in CI.",
    },
  },
  {
    id: "characterdata-rewrite",
    mechanism:
      "Site rewrites an EXISTING text node in place (React nodeValue/data assignment) — no node identity change.",
    provenance: "#98 (2026-09-26; root cause of the second x.com show-more escape; legacy React client)",
    status: "active",
    kind: "text",
    simulator: {
      page: "test-page.html",
      section: "#showmore-inplace-article",
      container: "#showmore-inplace-container",
      source: "#showmore-inplace-visible",
      trigger: "#showmore-inplace-btn",
    },
    scenarioRefs: ["content-update-conformance.mjs"],
    unitRefs: ["mutationObserver.characterData.test.js"],
    canary: {
      status: "not-covered",
      reason: "The #98 live-site verification (client-hints disguised x.com click) was done manually once; CI cannot reproduce it unattended.",
    },
  },
  {
    id: "container-textcontent-rewrite",
    mechanism:
      "Site rewrites a whole container via element.textContent assignment — old text node destroyed, new text node added (distinct mutation shape from single-span replace).",
    provenance: "#98 probe matrix (2026-09-26, \"span.textContent = \" row: partial coverage)",
    status: "active",
    kind: "text",
    simulator: {
      page: "test-page.html",
      section: "#showmore-textcontent-article",
      container: "#showmore-textcontent-container",
      source: null,
      trigger: "#showmore-textcontent-btn",
    },
    scenarioRefs: ["content-update-conformance.mjs"],
    unitRefs: ["contentUpdateChannels.test.js"],
    canary: {
      status: "not-covered",
      reason: "Same as childlist-replace: hermetic coverage only; no anonymous real-site repro available in CI.",
    },
  },
  {
    id: "attribute-rewrite",
    mechanism:
      "Site rewrites a translatable attribute (placeholder/alt/title/value) on an EXISTING element after translation.",
    provenance: "#98 channel audit (2026-09-27): observer has no `attributes` observation, getAttributesToTranslate runs only during the initial scan — forward-looking gap of the same family",
    status: "active",
    kind: "attribute",
    simulator: {
      page: "test-page.html",
      section: "#content-update-attr-article",
      container: "#attr-rewrite-wrap",
      trigger: "#attr-rewrite-btn",
      targets: [
        { selector: "#attr-rewrite-input", attrName: "placeholder" },
        { selector: "#attr-rewrite-input", attrName: "title" },
      ],
    },
    scenarioRefs: ["content-update-conformance.mjs"],
    unitRefs: ["attributeChannel.test.js"],
    canary: {
      status: "not-covered",
      reason: "Attribute channels were never observed on a real site report; hermetic coverage is the first line.",
    },
  },
  {
    id: "attribute-add",
    mechanism:
      "Site injects a NEW element carrying a translatable attribute (dynamic form fields).",
    provenance: "#98 channel audit (2026-09-27): newNodes path re-scans text only; attributes of injected elements are never collected — forward-looking gap",
    status: "active",
    kind: "attribute",
    simulator: {
      page: "test-page.html",
      section: "#content-update-attr-article",
      container: "#attr-add-wrap",
      trigger: "#attr-add-btn",
      targets: [
        { selector: "#attr-added-input", attrName: "placeholder" },
        { selector: "#attr-added-img", attrName: "alt" },
      ],
    },
    scenarioRefs: ["content-update-conformance.mjs"],
    unitRefs: ["attributeChannel.test.js"],
    canary: {
      status: "not-covered",
      reason: "Same as attribute-rewrite — hermetic coverage first.",
    },
  },
  {
    id: "css-only-reveal",
    mechanism:
      "Text is present in the DOM from the start but hidden with CSS; revealing it produces NO mutation — the negative assumption is that the scanner must not skip hidden text.",
    provenance: "Design audit 2026-09-27 (negative-assumption cell of the channel matrix)",
    status: "active",
    kind: "negative",
    simulator: {
      page: "test-page.html",
      section: "#content-update-attr-article",
      container: "#css-reveal-container",
      source: "#css-reveal-text",
      trigger: "#css-reveal-btn",
    },
    scenarioRefs: ["content-update-conformance.mjs"],
    unitRefs: ["contentUpdateChannels.test.js"],
    canary: {
      status: "not-covered",
      reason: "Negative assumption; hermetic coverage only.",
    },
  },
  {
    id: "closed-shadow-root",
    mechanism:
      "Content updates inside a closed shadow root.",
    provenance: "Design audit 2026-09-27 (physics boundary of the document-level observer)",
    status: "exempt",
    exemption: {
      reason:
        "The extension's MutationObserver is mounted on document.documentElement; closed shadow roots are not part of that tree, so extensions physically cannot observe them. Covering this would require an architecture change (per-shadow-root injection), out of scope.",
      upstreamImpact:
        "None for the current architecture: no tested behaviour depends on observing closed shadow roots; host pages themselves re-render such roots internally.",
    },
    scenarioRefs: [],
    unitRefs: [],
  },
];

/** Channels the conformance scenario must actually run in every display mode. */
export const ACTIVE_CHANNELS = CONTENT_UPDATE_CHANNELS.filter(
  (channel) => channel.status === "active"
);

/** Channel ids, for lint lookups. */
export const CONTENT_UPDATE_CHANNEL_IDS = CONTENT_UPDATE_CHANNELS.map((c) => c.id);
