/**
 * Tests for scripts/check-i18n-channels.js (spec 47 §2.4, the 17th lint).
 *
 * The lint is the enforcement arm of the i18n channel SSOT
 * (`tests/shared/i18n-channels.mjs`): every registered channel must point at a
 * real guard script, a real test anchor carrying the marker, and wiring that
 * actually mentions the guard. These cells drive the lint against small
 * fixtures — one clean (must pass) and one per rule (must fail) — so the lint
 * itself cannot rot into a false green.
 *
 *   C0  SSOT shape (non-empty, unique ids, required fields)
 *   C1  guard script exists
 *   C2  test anchor exists + contains the marker
 *   C3  wiring file exists + contains the needle
 *
 * Each invocation runs in its own fixture subdirectory (mirrors the
 * announcement-channels lint self-test discipline).
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "..", "scripts", "check-i18n-channels.js");

let tmpDir;
let counter = 0;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "i18n-channels-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Write a fixture tree and return its root. */
function buildFixture(files) {
  const root = join(tmpDir, `case-${counter++}`);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  return root;
}

/** Run the lint against a fixture root; returns {status, output}. */
function runLint(root) {
  try {
    const out = execFileSync("node", [SCRIPT, "--root", root], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output: out };
  } catch (err) {
    return {
      status: err.status ?? 1,
      output: String(err.stdout || "") + String(err.stderr || ""),
    };
  }
}

function channelEntry(overrides = {}) {
  return {
    id: "demo-channel",
    name: "Demo guard",
    kind: "hard",
    guard: { script: "scripts/demo-guard.js" },
    testAnchor: { file: "tests/demoGuard.test.js", marker: "demo marker" },
    wiring: [{ file: "scripts/pre-push-verify.sh", needle: "demo-guard.js" }],
    ...overrides,
  };
}

function ssotFor(entries) {
  return (
    "// fixture SSOT\nexport const I18N_CHANNELS = " +
    JSON.stringify(entries, null, 2) +
    ";\n"
  );
}

const cleanFiles = {
  "tests/shared/i18n-channels.mjs": ssotFor([channelEntry()]),
  "scripts/demo-guard.js": "// demo guard\n",
  "tests/demoGuard.test.js": "// demo marker lives here\nconst x = 'demo marker';\n",
  "scripts/pre-push-verify.sh": "node scripts/demo-guard.js\n",
};

describe("check-i18n-channels lint", () => {
  it("passes on a clean fixture (positive calibration)", () => {
    const root = buildFixture(cleanFiles);
    const { status, output } = runLint(root);
    expect(output).toContain("meta-check OK");
    expect(status).toBe(0);
  });

  it("fails C1 when a guard script is missing", () => {
    const files = { ...cleanFiles };
    delete files["scripts/demo-guard.js"];
    const root = buildFixture(files);
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain("[C1]");
    expect(output).toContain("guard script missing");
  });

  it("fails C2 when the test anchor exists but lacks the marker", () => {
    const files = {
      ...cleanFiles,
      "tests/demoGuard.test.js": "// no marker here\n",
    };
    const root = buildFixture(files);
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain("[C2]");
    expect(output).toContain("demo marker");
  });

  it("fails C2 when the test anchor file is missing entirely", () => {
    const files = { ...cleanFiles };
    delete files["tests/demoGuard.test.js"];
    const root = buildFixture(files);
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain("[C2]");
    expect(output).toContain("test anchor missing");
  });

  it("fails C3 when the wiring file does not mention the guard (not actually wired)", () => {
    const files = {
      ...cleanFiles,
      "scripts/pre-push-verify.sh": "echo nothing to see here\n",
    };
    const root = buildFixture(files);
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain("[C3]");
    expect(output).toContain("demo-guard.js");
  });

  it("fails C0 on duplicate channel ids", () => {
    const files = {
      ...cleanFiles,
      "tests/shared/i18n-channels.mjs": ssotFor([channelEntry(), channelEntry()]),
    };
    const root = buildFixture(files);
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain("[C0]");
    expect(output).toContain("duplicate channel id");
  });

  it("fails loudly when the SSOT itself cannot be loaded", () => {
    const files = { ...cleanFiles };
    delete files["tests/shared/i18n-channels.mjs"];
    const root = buildFixture(files);
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain("Cannot load");
  });
});
