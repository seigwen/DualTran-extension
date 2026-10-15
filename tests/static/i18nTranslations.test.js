/**
 * Real-translation gate self-test (plan 65 / the spec 47 L4
 * "translation-integrity" arm).
 *
 * Positive/negative calibration for scripts/check-i18n-translations.js and
 * scripts/i18n-translate.mjs — a detector that is never proven to fire is no
 * guard at all, and a clean tree must stay quiet:
 *   - clean fixture passes (no false positives);
 *   - every detector is proven to fire on a seeded break: mirror / stale /
 *     missing / empty / allowlist-dangling / allowlist-stale / format drift;
 *   - allowlist entries suppress exactly their own case (key-level brand
 *     token + pair-level legal identity), and a stale pair entry fails;
 *   - the tool flows are exercised end-to-end on fixtures: seed stamps
 *     existing translations and never stamps mirrors, restamp refuses
 *     mirrors, apply writes + stamps, apply rejects a placeholder-dropping
 *     payload;
 *   - the real tree passes (the permanent lock).
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { enHash } from "../../scripts/i18n-translate.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const LINT = join(REPO_ROOT, "scripts", "check-i18n-translations.js");
const TOOL = join(REPO_ROOT, "scripts", "i18n-translate.mjs");
const SYNC = join(REPO_ROOT, "scripts", "sync-locales.js");

let tmpRoot;
let counter = 0;
beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "i18n-translations-"));
});
afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/**
 * Build a fixture tree: src/_locales + the allowlist + the ledger.
 * `en` / `locals` map key -> entry ({ message, description? }).
 */
function buildFixture({
  en,
  locals = {},
  allowlist = [],
  ledger = { version: 1, locales: {} },
  rawOverrides = {},
}) {
  const root = join(tmpRoot, `case-${counter++}`);
  const write = (rel, content) => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  };
  write("src/_locales/en/messages.json", JSON.stringify(en, null, 2) + "\n");
  for (const [locale, messages] of Object.entries(locals)) {
    write(`src/_locales/${locale}/messages.json`, JSON.stringify(messages, null, 2) + "\n");
  }
  write(
    "tests/shared/i18n-translation-allowlist.mjs",
    "export const I18N_TRANSLATION_ALLOWLIST = " + JSON.stringify(allowlist, null, 2) + ";\n"
  );
  write("tests/shared/i18n-translation-ledger.json", JSON.stringify(ledger, null, 2) + "\n");
  for (const [rel, content] of Object.entries(rawOverrides)) write(rel, content);
  return root;
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: "utf8" });
  return { status: res.status, out: `${res.stdout || ""}${res.stderr || ""}` };
}
function runLint(root) {
  return run(process.execPath, [LINT, "--root", root]);
}
function runTool(args) {
  return run(process.execPath, [TOOL, ...args]);
}

const M = (message) => ({ message });
function stamped(locale, en, keys) {
  const map = {};
  for (const key of keys) map[key] = enHash(en[key].message);
  return { version: 1, locales: { [locale]: map } };
}

const EN = { greet: M("Hello"), save: M("Save") };
const DE_OK = { greet: M("Hallo"), save: M("Speichern") };

describe("real-translation gate (check-i18n-translations)", () => {
  it("passes on a clean fixture (negative calibration: no false positives)", () => {
    const root = buildFixture({
      en: EN,
      locals: { de: DE_OK },
      ledger: stamped("de", EN, ["greet", "save"]),
    });
    const { status, out } = runLint(root);
    expect(out).toContain("✅");
    expect(status).toBe(0);
  });

  it("fires on a mirror pair (value equals en)", () => {
    const root = buildFixture({
      en: EN,
      locals: { de: { greet: M("Hallo"), save: M("Save") } },
      ledger: stamped("de", EN, ["greet", "save"]),
    });
    const { status, out } = runLint(root);
    expect(status).toBe(1);
    expect(out).toContain("[mirror]");
    expect(out).toContain("de: save");
    expect(out).not.toContain("[missing]");
  });

  it("fires on a stale translation (ledger anchored to an older en text)", () => {
    const root = buildFixture({
      en: EN,
      locals: { de: DE_OK },
      ledger: { version: 1, locales: { de: { greet: enHash("Hi"), save: enHash("Save") } } },
    });
    const { status, out } = runLint(root);
    expect(status).toBe(1);
    expect(out).toContain("[stale]");
    expect(out).toContain("de: greet");
    expect(out).not.toContain("[mirror]");
  });

  it("fires on a missing ledger entry", () => {
    const root = buildFixture({
      en: EN,
      locals: { de: DE_OK },
      ledger: { version: 1, locales: { de: { greet: enHash("Hello") } } },
    });
    const { status, out } = runLint(root);
    expect(status).toBe(1);
    expect(out).toContain("[missing]");
    expect(out).toContain("de: save");
  });

  it("fires on an empty value", () => {
    const root = buildFixture({
      en: EN,
      locals: { de: { greet: M("   "), save: M("Speichern") } },
      ledger: stamped("de", EN, ["greet", "save"]),
    });
    const { status, out } = runLint(root);
    expect(status).toBe(1);
    expect(out).toContain("[empty]");
    expect(out).toContain("de: greet");
  });

  it("suppresses a key-level allowlisted identity (brand token, any locale)", () => {
    const root = buildFixture({
      en: { openaiLabel: M("OpenAI") },
      locals: { de: { openaiLabel: M("OpenAI") } },
      allowlist: [{ key: "openaiLabel", reason: "Brand name — kept in Latin script" }],
    });
    const { status, out } = runLint(root);
    expect(out).toContain("✅");
    expect(status).toBe(0);
  });

  it("suppresses a pair-level allowlisted identity (language's own word)", () => {
    const root = buildFixture({
      en: { no: M("No") },
      locals: { de: { no: M("No") } },
      allowlist: [{ key: "no", locale: "de", reason: "No is the German word itself" }],
    });
    const { status, out } = runLint(root);
    expect(out).toContain("✅");
    expect(status).toBe(0);
  });

  it("fires on a stale pair-level entry (pair no longer identical to en)", () => {
    const root = buildFixture({
      en: { no: M("No") },
      locals: { de: { no: M("Nein") } },
      allowlist: [{ key: "no", locale: "de", reason: "No is the German word itself" }],
    });
    const { status, out } = runLint(root);
    expect(status).toBe(1);
    expect(out).toContain("[allowlist-stale]");
  });

  it("fires on a dangling allowlist entry (key gone from en)", () => {
    const root = buildFixture({
      en: EN,
      locals: { de: DE_OK },
      ledger: stamped("de", EN, ["greet", "save"]),
      allowlist: [{ key: "ghostKey", reason: "leftover entry" }],
    });
    const { status, out } = runLint(root);
    expect(status).toBe(1);
    expect(out).toContain("[allowlist-dangling]");
    expect(out).toContain("ghostKey");
  });

  it("fires on format drift (non-canonical JSON)", () => {
    const root = buildFixture({
      en: EN,
      locals: { de: DE_OK },
      ledger: stamped("de", EN, ["greet", "save"]),
      rawOverrides: {
        "src/_locales/de/messages.json": JSON.stringify(DE_OK, null, 4) + "\n",
      },
    });
    const { status, out } = runLint(root);
    expect(status).toBe(1);
    expect(out).toContain("[format]");
    expect(out).toContain("de");
  });

  it("seed stamps existing translations, reports mirrors, and clears [missing]", () => {
    const root = buildFixture({
      en: EN,
      locals: { de: { greet: M("Hallo"), save: M("Save") } },
      ledger: { version: 1, locales: {} },
    });
    const seed = runTool(["seed", "--root", root]);
    expect(seed.status).toBe(0);
    expect(seed.out).toContain("mirrors skipped 1");
    const { status, out } = runLint(root);
    expect(status).toBe(1);
    expect(out).toContain("[mirror]");
    expect(out).toContain("de: save");
    expect(out).not.toContain("[missing]");
  });

  it("restamp refuses to stamp a mirror pair", () => {
    const root = buildFixture({
      en: EN,
      locals: { de: { greet: M("Hallo"), save: M("Save") } },
      ledger: { version: 1, locales: {} },
    });
    const restamp = runTool(["restamp", "--keys", "save", "--root", root]);
    expect(restamp.status).toBe(1);
    expect(restamp.out).toContain("mirrors skipped 1");
  });

  it("apply writes validated translations, stamps the ledger, and turns the tree green", () => {
    const root = buildFixture({
      en: EN,
      locals: { de: { greet: M("Hallo"), save: M("Save") } },
      ledger: stamped("de", EN, ["greet"]),
    });
    const payload = join(root, "payload.json");
    writeFileSync(payload, JSON.stringify({ translations: { de: { save: "Speichern" } } }), "utf8");
    const apply = runTool(["apply", "--root", root, "--file", payload]);
    expect(apply.status, apply.out).toBe(0);
    expect(apply.out).toContain("applied 1");
    const de = JSON.parse(readFileSync(join(root, "src/_locales/de/messages.json"), "utf8"));
    expect(de.save.message).toBe("Speichern");
    const { status, out } = runLint(root);
    expect(status, out).toBe(0);
  });

  it("apply rejects a payload that drops a placeholder", () => {
    const root = buildFixture({
      en: { tip: M("Hi $PROVIDER_NAME$") },
      locals: { de: { tip: M("Hallo $PROVIDER_NAME$") } },
      ledger: { version: 1, locales: {} },
    });
    const payload = join(root, "payload.json");
    writeFileSync(payload, JSON.stringify({ translations: { de: { tip: "Hallo" } } }), "utf8");
    const apply = runTool(["apply", "--root", root, "--file", payload]);
    expect(apply.status).toBe(1);
    expect(apply.out).toContain("placeholder mismatch");
  });

  it("sync-locales refuses silent English fill for a non-allowlisted missing key", () => {
    const root = buildFixture({ en: EN, locals: { de: { greet: M("Hallo") } } });
    const sync = run(process.execPath, [SYNC, "--root", root]);
    expect(sync.status).toBe(1);
    expect(sync.out).toContain("REAL translations");
    const de = JSON.parse(readFileSync(join(root, "src/_locales/de/messages.json"), "utf8"));
    expect(de.save).toBeUndefined();
  });

  it("sync-locales still fills an allowlisted brand key and stays quiet", () => {
    const root = buildFixture({
      en: { ...EN, openaiLabel: M("OpenAI") },
      locals: { de: { greet: M("Hallo"), save: M("Speichern") } },
      allowlist: [{ key: "openaiLabel", reason: "Brand name — kept in Latin script" }],
    });
    const sync = run(process.execPath, [SYNC, "--root", root]);
    expect(sync.status, sync.out).toBe(0);
    const de = JSON.parse(readFileSync(join(root, "src/_locales/de/messages.json"), "utf8"));
    expect(de.openaiLabel.message).toBe("OpenAI");
  });

  it("passes on the real tree (the permanent lock)", () => {
    const { status, out } = runLint(REPO_ROOT);
    expect(status, out).toBe(0);
  });
});
