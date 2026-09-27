/**
 * record-mutations.mjs — real-site mutation recorder (C8, plan #29).
 *
 * Records DOM mutations on a live page and classifies them by the
 * content-update channel taxonomy (tests/shared/content-update-channels.mjs),
 * so that "post-translation site update not re-translated" reports (#7, #98
 * family) can be mapped to a channel id instead of being re-diagnosed ad hoc
 * every time. The #98 live probe was throwaway code that died with its
 * debugging session (doc 13's recurring lesson) — this is its permanent home.
 *
 * Usage:
 *   node scripts/record-mutations.mjs --url=<url> [--seconds=30]
 *                                     [--ua-profile=chrome-desktop|none]
 *                                     [--out=<path.json>]
 *
 * Defaults: --seconds=30 --ua-profile=none.
 * `--ua-profile=chrome-desktop` installs a client-hints disguise
 * (Network.setUserAgentOverride + userAgentMetadata) — required for sites
 * like x.com that 403 plain data-centre/headless clients. Recorded evidence
 * must note which profile was used; the JSON carries it in `uaProfile`.
 *
 * Trigger the update by hand (click "Show more", scroll a lazy list, …) while
 * the recorder runs; press Ctrl-C early to stop and still get the JSON.
 *
 * Offline self-test (no real site needed — verifies all five classifications):
 *   python3 -m http.server 8931 --directory extra/e2e &
 *   xvfb-run -a node scripts/record-mutations.mjs \
 *     --url=http://127.0.0.1:8931/record-mutations-selftest.html --seconds=8
 *   → expect one record each in: characterdata-rewrite, childlist-append,
 *     childlist-replace, attribute-rewrite, attribute-add (verified
 *     2026-09-27; the fixture fires its mutations 4s after load).
 *
 * Output JSON shape:
 *   {
 *     url, startedAt, seconds, uaProfile,
 *     total, truncated,
 *     channels: { "<channel-id>": { count, samples: [ {type, attrName?, target} ] } },
 *     unclassified: { ... same shape ... }
 *   }
 *
 * Channel mapping (mirrors the SSOT taxonomy):
 *   childList + addedNodes>0 + removedNodes==0   → childlist-append
 *   childList + removedNodes>0                   → childlist-replace
 *   characterData                                → characterdata-rewrite
 *   attributes                                   → attribute-rewrite / attribute-add
 *     (attribute-add requires the target element itself to be newly added —
 *      the recorder marks it when a prior record in the same batch added the
 *      element; otherwise attribute-rewrite)
 *   no mutations at all                          → css-only-reveal is the
 *     candidate (CSS visibility change produces no mutation record)
 *
 * This tool only OBSERVES — it does not translate, and it does not import the
 * extension. Feed its JSON into tests/shared/content-update-channels.mjs
 * provenance when a new channel is discovered.
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

// ─── CLI ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const url = (args.find((a) => a.startsWith("--url=")) || "").slice("--url=".length);
const seconds = Number((args.find((a) => a.startsWith("--seconds=")) || "--seconds=30").slice("--seconds=".length));
const uaProfile = (args.find((a) => a.startsWith("--ua-profile=")) || "--ua-profile=none").slice("--ua-profile=".length);
const outArg = args.find((a) => a.startsWith("--out="));

if (!url) {
  console.error("Usage: node scripts/record-mutations.mjs --url=<url> [--seconds=30] [--ua-profile=chrome-desktop] [--out=<path.json>]");
  process.exit(2);
}

const outPath = outArg
  ? path.resolve(outArg.slice("--out=".length))
  : path.resolve(`mutation-recording-${Date.now()}.json`);

/** Client-hints disguise for bot-walled sites (x.com 403s on plain clients). */
const UA_PROFILES = {
  "chrome-desktop": {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    metadata: {
      brands: [
        { brand: "Chromium", version: "131" },
        { brand: "Google Chrome", version: "131" },
        { brand: "Not_A Brand", version: "24" },
      ],
      fullVersion: "131.0.6778.86",
      platform: "Windows",
      platformVersion: "10.0.0",
      architecture: "x86",
      model: "",
      mobile: false,
    },
  },
};

// ─── Recorder ───────────────────────────────────────────────────────

/**
 * Page-side recorder. Kept as a string so it can be injected after
 * navigation (and survive same-document SPA updates).
 * Classifies each mutation at record time into a channel id, keeping the
 * classification logic in one place — Python-side aggregation only counts.
 */
const RECORDER = `
window.__DualTranMutationRecorder = (() => {
  const MAX_RECORDS = 2000;
  const records = [];
  let truncated = false;

  const summarizeTarget = (node) => {
    if (!node) return "(null)";
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      return "text@<" + (parent ? parent.tagName.toLowerCase() : "?") + ">";
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "nodeType" + node.nodeType;
    let s = node.tagName.toLowerCase();
    if (node.id) s += "#" + node.id;
    if (node.className && typeof node.className === "string") {
      s += "." + node.className.trim().split(/\\s+/).slice(0, 2).join(".");
    }
    return s;
  };

  const classify = (m, batchAdded) => {
    if (m.type === "childList") {
      return m.removedNodes.length > 0 ? "childlist-replace" : "childlist-append";
    }
    if (m.type === "characterData") return "characterdata-rewrite";
    if (m.type === "attributes") {
      // attribute-add: the element carrying the attribute was itself added in
      // this batch; attribute-rewrite: it already existed.
      return batchAdded.has(m.target) ? "attribute-add" : "attribute-rewrite";
    }
    return "unclassified";
  };

  const observer = new MutationObserver((mutations) => {
    // Elements added in this callback batch — lets attribute-add be told
    // apart from attribute-rewrite without tracking the full document.
    const batchAdded = new Set();
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n.nodeType === Node.ELEMENT_NODE) batchAdded.add(n);
      }
    }
    for (const m of mutations) {
      if (records.length >= MAX_RECORDS) { truncated = true; continue; }
      records.push({
        type: m.type,
        attrName: m.attributeName || null,
        target: summarizeTarget(m.target),
        channel: classify(m, batchAdded),
      });
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });

  return {
    snapshot: () => ({ records: records.slice(), truncated }),
    stop: () => observer.disconnect(),
  };
})();
"true";
`;

// ─── Main ───────────────────────────────────────────────────────────

const profile = UA_PROFILES[uaProfile];
if (uaProfile !== "none" && !profile) {
  console.error(`Unknown --ua-profile=${uaProfile} (known: none, ${Object.keys(UA_PROFILES).join(", ")})`);
  process.exit(2);
}

const browser = await chromium.launch({
  headless: false, // real window: x.com-class sites treat headless as bot
  args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
});
const context = await browser.newContext();
const page = await context.newPage();

if (profile) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.setUserAgentOverride", {
    userAgent: profile.userAgent,
    acceptLanguage: "en-US,en;q=0.9",
    platform: "Win32",
    userAgentMetadata: profile.metadata,
  });
  console.log(`[record-mutations] client-hints disguise: chrome-desktop`);
}

const startedAt = new Date().toISOString();
console.log(`[record-mutations] navigating to ${url}`);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => {
  console.error(`[record-mutations] navigation failed: ${e.message}`);
});
await page.waitForTimeout(2000);

await page.evaluate(RECORDER);
console.log(`[record-mutations] recording for ${seconds}s — trigger the update by hand now (Ctrl-C stops early and still writes the JSON)`);

let interrupted = false;
const stopEarly = async () => {
  interrupted = true;
};
process.on("SIGINT", stopEarly);

const deadline = Date.now() + seconds * 1000;
while (!interrupted && Date.now() < deadline) {
  await page.waitForTimeout(500);
}

const result = await page.evaluate(() =>
  window.__DualTranMutationRecorder ? window.__DualTranMutationRecorder.snapshot() : { records: [], truncated: false }
);

// ─── Aggregate + write ──────────────────────────────────────────────

const channels = {};
for (const r of result.records) {
  const key = r.channel;
  if (!channels[key]) channels[key] = { count: 0, samples: [] };
  channels[key].count++;
  if (channels[key].samples.length < 8) {
    channels[key].samples.push({ type: r.type, attrName: r.attrName, target: r.target });
  }
}

const payload = {
  url,
  startedAt,
  stoppedAt: new Date().toISOString(),
  seconds,
  uaProfile,
  interrupted,
  total: result.records.length,
  truncated: result.truncated,
  channels,
  unclassified: channels.unclassified || { count: 0, samples: [] },
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

console.log(`[record-mutations] ${result.records.length} mutation(s) recorded${result.truncated ? " (TRUNCATED at 2000)" : ""}`);
for (const [ch, info] of Object.entries(channels)) {
  console.log(`  ${ch.padEnd(28)} ${String(info.count).padStart(5)}  e.g. ${info.samples[0]?.target ?? "-"}`);
}
if (result.records.length === 0) {
  console.log("  (no mutations — css-only-reveal is the candidate channel iff the page state changed)");
}
console.log(`[record-mutations] JSON → ${outPath}`);

await browser.close();
process.exit(0);
