/**
 * Tests for scripts/check-announcement-channels.js
 *
 * The lint is the enforcement arm of the announcement-channel SSOT
 * (tests/shared/announcement-channels.mjs, plan 40 / #137 part B). Its job:
 * make it impossible for a pageLanguageState announcement to leak outside the
 * single outlet, for a channel to exist without a behavioral pin, for a
 * navigation scenario to skip highlight-vs-intent assertions, or for
 * user-level semantics to silently reappear inside the mirror-only subscriber
 * region.
 *
 * Each rule gets a negative fixture (must fail) and, for the structural rules,
 * a positive fixture (must pass), so the lint itself cannot become one of the
 * false greens it exists to prevent.
 *
 *   A0  provenance required
 *   A1  outlet uniqueness — raw emit tokens only inside the outlet body
 *   A2  probe presence — probeRequired channels must be pinned by probeTokens
 *   A3  navigation scenarios must read the highlight + assert SSOT (or be
 *       explicitly exempted with a reason)
 *   A4  mirror-only region forbids semantic tokens
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "..", "scripts", "check-announcement-channels.js");

let tmpDir;
let counter = 0;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "announcement-channels-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** The outlet file content: single function owning both emit shapes. */
const goodOutletFile = `
  pageTranslator.announcePageLanguageState = announcePageLanguageState;
  function announcePageLanguageState(nextState, { silent = false } = {}) {
    if (silent) return;
    try {
      chrome.runtime.sendMessage({
        action: "setPageLanguageState",
        state: nextState,
      });
    } catch {}
    pageLanguageStateObservers.forEach((callback) => callback(nextState));
  }

  function afterOutlet() {}
`;

/** The mirror-only subscriber file: markers + non-semantic body. */
const goodMirrorFile = `
  function mount() {
    // [mirror-only:begin]
    onPageLanguageStateChange(() => {
      setState({ pageLanguageState: "translated" }, "mirror");
    });
    // [mirror-only:end]
  }
`;

/** The E2E scenario: navigates AND locks highlight+SSOT. */
const goodScenario = `
export async function run(scope) {
  await scope.page.goBack();
  const cls = await scope.page.evaluate(() => getFloatingBtnHighlight());
  expect(cls).toBe("ai");
  await assertUiStateMatchesEngine(scope.page);
}
`;

/** The probe file pinning the fixture channel (must NAME it + carry a token). */
const goodProbe = `
// Comments are decomposed before scanning — the id below must be real code.
const channel = "fixture-channel";
it("fixture channel mirrors", () => {
  expect(channel).toBe("fixture-channel");
  expect(probeTokenX).toBeDefined();
});
`;

/**
 * Build the SSOT module for the fixture. One probeRequired channel (pinned by
 * goodProbe) + the outlet/mirror/nav contracts pointing at the fixture files.
 */
function makeSsat({
  channelsOverrides = {},
  outletOverrides = {},
  mirrorOverrides = {},
  navOverrides = {},
} = {}) {
  const channel = {
    id: "fixture-channel",
    kind: "announcement",
    emitter: "announcePageLanguageState",
    suppress: "funnel-silent-flag",
    consumers: ["floatingBtn"],
    consumerRole: "mirror-only",
    probeRefs: ["fixture.test.js"],
    probeTokens: ["probeTokenX"],
    probeRequired: true,
    provenance: "#1 (2026-01-01 fixture)",
    ...channelsOverrides,
  };
  return `
export const ANNOUNCEMENT_CHANNELS = [
  ${JSON.stringify(channel)},
];
export const ANNOUNCEMENT_OUTLET = ${JSON.stringify({
    file: "src/contentScript/pageTranslator.js",
    functionName: "announcePageLanguageState",
    forbiddenRawTokens: [
      "pageLanguageStateObservers.forEach",
      'action: "setPageLanguageState"',
    ],
    ...outletOverrides,
  })};
export const MIRROR_ONLY_CONTRACT = ${JSON.stringify({
    file: "src/contentScript/floatingBtn.js",
    beginMarker: "[mirror-only:begin]",
    endMarker: "[mirror-only:end]",
    forbiddenTokens: ["setAiModeActive", "setHighlight(", "displayMode"],
    ...mirrorOverrides,
  })};
export const NAV_ASSERT_CONTRACT = ${JSON.stringify({
    highlightReadTokens: ["getFloatingBtnHighlight"],
    ssotToken: "assertUiStateMatchesEngine",
    exemptionMarker: "// nav-assert-allow:",
    ...navOverrides,
  })};
`;
}

/**
 * Run the lint against an isolated fixture root.
 *
 * @param {{ ssot?: string, outletFile?: string, mirrorFile?: string,
 *           scenario?: string|null, probe?: string|null }} spec
 */
function runCheck(spec) {
  const root = join(tmpDir, `case-${counter++}`);
  mkdirSync(join(root, "tests", "shared"), { recursive: true });
  mkdirSync(join(root, "tests", "browser-e2e"), { recursive: true });
  mkdirSync(join(root, "tests", "contentScript"), { recursive: true });
  mkdirSync(join(root, "src", "contentScript"), { recursive: true });

  writeFileSync(join(root, "tests", "shared", "announcement-channels.mjs"), spec.ssot ?? makeSsat());
  writeFileSync(
    join(root, "src", "contentScript", "pageTranslator.js"),
    spec.outletFile ?? goodOutletFile
  );
  writeFileSync(
    join(root, "src", "contentScript", "floatingBtn.js"),
    spec.mirrorFile ?? goodMirrorFile
  );
  if (spec.scenario !== null) {
    writeFileSync(
      join(root, "tests", "browser-e2e", "fixture-scenario.mjs"),
      spec.scenario ?? goodScenario
    );
  }
  if (spec.probe !== null) {
    writeFileSync(join(root, "tests", "contentScript", "fixture.test.js"), spec.probe ?? goodProbe);
  }

  try {
    const out = execFileSync("node", [SCRIPT, "--root", root], { encoding: "utf8" });
    return { exitCode: 0, out };
  } catch (e) {
    return {
      exitCode: e.status ?? 1,
      out: (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? ""),
    };
  }
}

describe("check-announcement-channels", () => {
  it("passes a fully-wired fixture", () => {
    const { exitCode, out } = runCheck({});
    expect(out).toContain("✅");
    expect(exitCode).toBe(0);
  });

  it("exempts a navigation scenario carrying a written reason", () => {
    const { exitCode } = runCheck({
      scenario: `
export async function run(scope) {
  // nav-assert-allow: about:blank has no floating button mount
  await scope.page.goBack();
}
`,
    });
    expect(exitCode).toBe(0);
  });

  it("A0: fails a channel without provenance", () => {
    const { exitCode, out } = runCheck({
      ssot: makeSsat({ channelsOverrides: { provenance: "" } }),
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("A0");
  });

  it("A1: fails a raw emit token outside the outlet body", () => {
    const { exitCode, out } = runCheck({
      outletFile: `
  function announcePageLanguageState() {
    pageLanguageStateObservers.forEach((c) => c("x"));
    chrome.runtime.sendMessage({ action: "setPageLanguageState" });
  }

  function leaky() {
    pageLanguageStateObservers.forEach((c) => c("x"));
  }
`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("A1");
    expect(out).toContain("outside the single outlet");
  });

  it("A1: fails when the outlet does not own both channels", () => {
    const { exitCode, out } = runCheck({
      outletFile: `
  function announcePageLanguageState() {
    pageLanguageStateObservers.forEach((c) => c("x"));
  }
`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("must own BOTH channels");
  });

  it("A1: a comment inside the outlet must not satisfy the both-channels check", () => {
    const { exitCode, out } = runCheck({
      outletFile: `
  function announcePageLanguageState() {
    // action: "setPageLanguageState" is emitted elsewhere someday
    pageLanguageStateObservers.forEach((c) => c("x"));
  }
`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("must own BOTH channels");
  });

  it("A2: fails when probeTokens are absent from every probeRef (comments excluded)", () => {
    const { exitCode, out } = runCheck({
      probe: `
it("fake pin", () => {
  const channel = "fixture-channel";
  // probeTokenX in a comment must not count
});
`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("A2");
    expect(out).toContain("probeTokens");
  });

  it("A2: fails when a probeRef does not NAME the channel (comments excluded)", () => {
    const { exitCode, out } = runCheck({
      probe: `
it("pin without naming the channel", () => {
  expect(probeTokenX).toBeDefined();
});
`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("A2");
    expect(out).toContain("does not appear");
  });

  it("A2: fails when the probeRequired flag is omitted (escape hatch by omission)", () => {
    const { exitCode, out } = runCheck({
      ssot: makeSsat({ channelsOverrides: { probeRequired: undefined } }),
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("A2");
    expect(out).toContain("explicitly");
  });

  it("A2: fails probeRequired:false without a written probeExempt reason", () => {
    const { exitCode, out } = runCheck({
      ssot: makeSsat({ channelsOverrides: { probeRequired: false, probeRefs: [], probeTokens: [] } }),
      probe: null,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("A2");
    expect(out).toContain("probeExempt");
  });

  it("A2: passes probeRequired:false WITH a written probeExempt reason", () => {
    const { exitCode } = runCheck({
      ssot: makeSsat({
        channelsOverrides: {
          probeRequired: false,
          probeExempt: "covered by the navRestore SSOT traversal suite",
        },
      }),
      probe: null,
    });
    expect(exitCode).toBe(0);
  });

  it("A2: fails when a probeRef file does not exist", () => {
    const { exitCode, out } = runCheck({ probe: null });
    expect(exitCode).toBe(1);
    expect(out).toContain("A2");
  });

  it("A3: fails a navigation scenario without highlight/SSOT assertions", () => {
    const { exitCode, out } = runCheck({
      scenario: `
export async function run(scope) {
  await scope.page.goBack();
  await scope.page.goForward();
}
`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("A3");
  });

  it("A3: fails when only the highlight read is present", () => {
    const { exitCode, out } = runCheck({
      scenario: `
export async function run(scope) {
  await scope.page.goBack();
  const cls = await scope.page.evaluate(() => getFloatingBtnHighlight());
  expect(cls).toBe("ai");
}
`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("A3");
    expect(out).toContain("assertUiStateMatchesEngine");
  });

  it("A3: a bare reference (never called) does not satisfy the SSOT assertion", () => {
    const { exitCode, out } = runCheck({
      scenario: `
const ssotHelper = assertUiStateMatchesEngine; // referenced, never called
export async function run(scope) {
  await scope.page.goBack();
  const cls = await scope.page.evaluate(() => getFloatingBtnHighlight());
  expect(cls).toBe("ai");
}
`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("A3");
  });

  it("A4: fails a forbidden semantic token inside the mirror-only region", () => {
    const { exitCode, out } = runCheck({
      mirrorFile: `
  function mount() {
    // [mirror-only:begin]
    onPageLanguageStateChange(() => {
      setAiModeActive(false);
    });
    // [mirror-only:end]
  }
`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("A4");
    expect(out).toContain("setAiModeActive");
  });

  it("A4: a forbidden token in a comment must not count", () => {
    const { exitCode } = runCheck({
      mirrorFile: `
  function mount() {
    // [mirror-only:begin]
    // setAiModeActive(false) used to live here (#134)
    onPageLanguageStateChange(() => {});
    // [mirror-only:end]
  }
`,
    });
    expect(exitCode).toBe(0);
  });

  it("A4: fails when the markers are missing", () => {
    const { exitCode, out } = runCheck({
      mirrorFile: `
  function mount() {
    onPageLanguageStateChange(() => {});
  }
`,
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("A4");
    expect(out).toContain("markers");
  });
});

// ── Implementation-point map (CLAUDE.md rule: 意图驱动高亮规则, plan 40 / #137) ──
// announcePageLanguageState (pageTranslator.js) — the single announcement
//   outlet: owns BOTH pageLanguageState channels (observer broadcast + SW
//   setPageLanguageState message); the lint's A1 fixtures above pin outlet
//   uniqueness (raw emit tokens outside the outlet body fail, both channels
//   must live inside, comments do not satisfy the check), and
//   pageTranslator.navRestore.integration.test.js「通告通道完备性（SSOT 遍历版）」
//   pins the sequence behavior (silent zero-leak + non-silent broadcast per
//   ANNOUNCEMENT_CHANNELS channel).
// MIRROR_ONLY_CONTRACT (tests/shared/announcement-channels.mjs) — the
//   mirror-only subscriber contract; A4 fixtures above pin it (forbidden
//   semantic tokens inside the marked region fail; comment mentions do not;
//   missing markers fail).
// ANNOUNCEMENT_CHANNELS (tests/shared/announcement-channels.mjs) — the
//   channel SSOT consumed by both the lint (A0–A4) and the SSOT-traversal
//   probe suite; fixture tests above pin rule behavior.
