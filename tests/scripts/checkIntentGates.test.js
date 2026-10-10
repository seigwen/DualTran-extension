/**
 * Tests for scripts/check-intent-gates.js — self-test discipline mirroring
 * checkAnnouncementChannels.test.js ("a lint cannot become one of the false
 * greens it exists to prevent").
 *
 * The lint is the enforcement arm of the intent-gate SSOT
 * (tests/shared/intent-gates.mjs, plan 51). Its job: no unregistered intent
 * reads, no stale registry entries, counts always in sync (I0–I4), and the
 * masker must never count comments / strings / regex literals — nor lose
 * code after a regex that contains a backtick (the regression that motivated
 * the regex-position heuristic).
 *
 * Each rule gets a negative fixture (must fail) and, for the structural
 * rules, a positive fixture (must pass).
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { INTENT_GATES, INTENT_TOKENS } from "../shared/intent-gates.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "..", "scripts", "check-intent-gates.js");
const REPO_ROOT = join(__dirname, "..", "..");

let tmpDir;
let counter = 0;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "intent-gates-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Fixture source: two segments (alpha/beta) exercising every masking rule —
 * comment refs, string refs, a template interpolation (counted), a regex
 * carrying a backtick + quote, and a cross-line regex.
 * Expected: alpha {tokenA:1, tokenB:1}, beta {tokenB:1}.
 */
const GOOD_SRC = [
  "",
  "// [intent-gate:alpha]",
  "const a = tokenA; // tokenA in a comment — masked out",
  'const s = "tokenA in a string — masked out";',
  "const t = `x ${tokenB} y`; // interpolation is code — counted",
  'const re = /[\\$\\uFFE5`~<>"]/; // regex with backtick+quote — masked out',
  "const re2 =",
  '  /x`y|["\']/;',
  "// [intent-gate:beta]",
  "const b =",
  "  tokenB;",
  "",
].join("\n");

function makeSsat(overrides = {}) {
  const gates = overrides.gates ?? [
    {
      id: "alpha",
      file: "src/contentScript/fixture.js",
      refs: { tokenA: 1, tokenB: 1 },
      semantics: "level",
      locks: ["fixture.lock.js"],
      provenance: "fixture",
    },
    {
      id: "beta",
      file: "src/contentScript/fixture.js",
      refs: { tokenB: 1 },
      semantics: "level",
      locks: [],
      provenance: "fixture",
    },
  ];
  const tokens = overrides.tokens ?? ["tokenA", "tokenB"];
  const files = overrides.files ?? ["src/contentScript/fixture.js"];
  return [
    `export const INTENT_TOKENS = ${JSON.stringify(tokens)};`,
    `export const INTENT_SCAN_FILES = ${JSON.stringify(files)};`,
    `export const INTENT_GATES = ${JSON.stringify(gates)};`,
    "",
  ].join("\n");
}

function writeRoot(ssotText, files = {}, { withLock = true } = {}) {
  const root = join(tmpDir, `fx-${counter++}`);
  mkdirSync(join(root, "tests", "shared"), { recursive: true });
  mkdirSync(join(root, "src", "contentScript"), { recursive: true });
  writeFileSync(join(root, "tests", "shared", "intent-gates.mjs"), ssotText);
  if (withLock) writeFileSync(join(root, "fixture.lock.js"), "// fixture lock\n");
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(root, rel), content);
  return root;
}

function runLint(root, extraArgs = []) {
  try {
    const out = execFileSync("node", [SCRIPT, "--root", root, ...extraArgs], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, out };
  } catch (err) {
    return { status: err.status ?? 1, out: `${err.stdout || ""}${err.stderr || ""}` };
  }
}

const FIXTURE = "src/contentScript/fixture.js";

describe("check-intent-gates — clean fixture", () => {
  it("passes when markers, registry and counts agree", () => {
    const root = writeRoot(makeSsat(), { [FIXTURE]: GOOD_SRC });
    const r = runLint(root);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("✅");
  });

  it("--probe prints segments and exits 0", () => {
    const root = writeRoot(makeSsat(), { [FIXTURE]: GOOD_SRC });
    const r = runLint(root, ["--probe"]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("[intent-gate:alpha]");
    expect(r.out).toContain("[intent-gate:beta]");
  });
});

describe("check-intent-gates — I0 SSOT contract", () => {
  it("rejects an invalid semantics value", () => {
    const gates = makeSsatGate("alpha", { semantics: "sometimes" });
    const root = writeRoot(makeSsat({ gates: [gates] }), { [FIXTURE]: GOOD_SRC });
    const r = runLint(root);
    expect(r.status).toBe(1);
    expect(r.out).toContain("invalid semantics");
  });

  it("requires a written reason for edge semantics", () => {
    const gates = makeSsatGate("alpha", { semantics: "edge" });
    const root = writeRoot(makeSsat({ gates: [gates] }), { [FIXTURE]: GOOD_SRC });
    const r = runLint(root);
    expect(r.status).toBe(1);
    expect(r.out).toContain("requires a written reason");
  });

  it("rejects a missing lock file", () => {
    const gates = makeSsatGate("alpha", { locks: ["nope.lock.js"] });
    const root = writeRoot(makeSsat({ gates: [gates] }), { [FIXTURE]: GOOD_SRC });
    const r = runLint(root);
    expect(r.status).toBe(1);
    expect(r.out).toContain("lock file missing");
  });

  it("requires provenance", () => {
    const gates = makeSsatGate("alpha", { provenance: "" });
    const root = writeRoot(makeSsat({ gates: [gates] }), { [FIXTURE]: GOOD_SRC });
    const r = runLint(root);
    expect(r.status).toBe(1);
    expect(r.out).toContain("requires provenance");
  });

  it("rejects unknown ref tokens", () => {
    const gates = makeSsatGate("alpha", { refs: { tokenZ: 1 } });
    const root = writeRoot(makeSsat({ gates: [gates] }), { [FIXTURE]: GOOD_SRC });
    const r = runLint(root);
    expect(r.status).toBe(1);
    expect(r.out).toContain('unknown token "tokenZ"');
  });
});

describe("check-intent-gates — I1 marker <-> registry", () => {
  it("rejects a marker that is not registered", () => {
    const src = GOOD_SRC + "// [intent-gate:gamma]\nconst g = 1;\n";
    const root = writeRoot(makeSsat(), { [FIXTURE]: src });
    const r = runLint(root);
    expect(r.status).toBe(1);
    expect(r.out).toContain("[intent-gate:gamma] is not registered");
  });

  it("rejects a registered gate without a marker (stale entry)", () => {
    const gates = [makeSsatGate("alpha"), makeSsatGate("beta"), makeSsatGate("stale")];
    const root = writeRoot(makeSsat({ gates }), { [FIXTURE]: GOOD_SRC });
    const r = runLint(root);
    expect(r.status).toBe(1);
    expect(r.out).toContain("stale registry entry");
  });

  it("rejects a duplicate marker id inside one file", () => {
    const src = GOOD_SRC + "// [intent-gate:alpha]\nconst dup = 1;\n";
    const root = writeRoot(makeSsat(), { [FIXTURE]: src });
    const r = runLint(root);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/duplicate marker|must be exactly one/);
  });
});

describe("check-intent-gates — I2 orphan refs", () => {
  it("rejects a ref before the first marker", () => {
    const src = "const pre = tokenA;\n" + GOOD_SRC;
    const root = writeRoot(makeSsat(), { [FIXTURE]: src });
    const r = runLint(root);
    expect(r.status).toBe(1);
    expect(r.out).toContain("outside any segment");
  });
});

describe("check-intent-gates — I3 count sentinel", () => {
  it("rejects an extra naked ref inside a segment (declared 1, actual 2)", () => {
    const src = GOOD_SRC.replace(
      "const a = tokenA; //",
      "const a = tokenA;\nconst sneak = tokenA; //"
    );
    const root = writeRoot(makeSsat(), { [FIXTURE]: src });
    const r = runLint(root);
    expect(r.status).toBe(1);
    expect(r.out).toContain('segment "alpha": "tokenA" declared 1, actual 2');
  });

  it("rejects a removed ref (declared 1, actual 0)", () => {
    const src = GOOD_SRC.replace("  tokenB;", "  /* removed */;");
    const root = writeRoot(makeSsat(), { [FIXTURE]: src });
    const r = runLint(root);
    expect(r.status).toBe(1);
    expect(r.out).toContain('segment "beta": "tokenB" declared 1, actual 0');
  });

  it("does not count comment / string occurrences (over-count guard)", () => {
    const gates = [makeSsatGate("alpha", { refs: { tokenA: 2, tokenB: 1 } }), makeSsatGate("beta")];
    const root = writeRoot(makeSsat({ gates }), { [FIXTURE]: GOOD_SRC });
    const r = runLint(root);
    expect(r.status).toBe(1);
    expect(r.out).toContain('segment "alpha": "tokenA" declared 2, actual 1');
  });
});

describe("check-intent-gates — masker regression locks", () => {
  it("counts template interpolations (code) but not the template text", () => {
    const src = [
      "// [intent-gate:one]",
      "const t = `tokenA ${tokenA}`;",
      "",
    ].join("\n");
    const gates = [makeSsatGate("one", { refs: { tokenA: 1 } })];
    const root = writeRoot(makeSsat({ gates }), { [FIXTURE]: src });
    const r = runLint(root);
    expect(r.status, r.out).toBe(0);
  });

  it("survives a regex containing a backtick (no cascade into later segments)", () => {
    const src = [
      "// [intent-gate:one]",
      'const re = /[\\$`"\'~<>]/; // backtick inside a regex',
      "const b = tokenB;",
      "// [intent-gate:two]",
      "const t = `${tokenA}`;",
      "",
    ].join("\n");
    const gates = [
      makeSsatGate("one", { refs: { tokenB: 1 } }),
      makeSsatGate("two", { refs: { tokenA: 1 } }),
    ];
    const root = writeRoot(makeSsat({ gates }), { [FIXTURE]: src });
    const r = runLint(root);
    // Old masker bug: the regex's backtick opened a phantom template and the
    // rest of the file was swallowed — tokenB would go missing (actual 0).
    expect(r.status, r.out).toBe(0);
  });
});

describe("check-intent-gates — I4 scan-file completeness", () => {
  it("rejects refs in a file that is not listed in INTENT_SCAN_FILES", () => {
    const root = writeRoot(makeSsat(), {
      [FIXTURE]: GOOD_SRC,
      "src/contentScript/rogue.js": "const x = tokenA;\n",
    });
    const r = runLint(root);
    expect(r.status).toBe(1);
    expect(r.out).toContain("not listed in INTENT_SCAN_FILES");
  });

  it("rejects a listed file that is missing on disk", () => {
    const root = writeRoot(makeSsat({ files: [FIXTURE, "src/contentScript/ghost.js"] }), {
      [FIXTURE]: GOOD_SRC,
    });
    const r = runLint(root);
    expect(r.status).toBe(1);
    expect(r.out).toContain("missing on disk");
  });
});

describe("check-intent-gates — real tree", () => {
  it("passes on the real repository and declares a consistent registry", () => {
    const r = runLint(REPO_ROOT);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("intent-gate check passed");
  });

  it("real registry: ids unique, refs tokens known, provenance present", () => {
    expect(INTENT_TOKENS.length).toBeGreaterThan(0);
    const ids = INTENT_GATES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of INTENT_GATES) {
      expect(g.provenance).toBeTruthy();
      for (const k of Object.keys(g.refs)) expect(INTENT_TOKENS).toContain(k);
    }
  });
});

/** Helper: a valid gate entry bound to the fixture file. */
function makeSsatGate(id, overrides = {}) {
  return {
    id,
    file: FIXTURE,
    refs: id === "beta" ? { tokenB: 1 } : id === "two" ? { tokenA: 1 } : { tokenA: 1, tokenB: 1 },
    semantics: "level",
    locks: ["fixture.lock.js"],
    provenance: "fixture",
    ...overrides,
  };
}
