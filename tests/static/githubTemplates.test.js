/**
 * GitHub template guard — user-facing `.github/` files stay English-only and
 * the extension↔form prefill contract cannot drift (issue #121).
 *
 * Why: GitHub renders issue forms / templates from static repository files
 * with no i18n mechanism (the extension's `src/_locales/` route does not
 * exist here). The four advanced-QA fields of `bug_report.yml` once carried
 * hardcoded Chinese — a non-Chinese reporter hit a half-Chinese form at the
 * exact fields that exist to sharpen triage (user report, 2026-09-30).
 * This guard makes the discipline machine-checked:
 *
 *   1. CJK scan over the user-facing GitHub surface (dynamic template list —
 *      a newly added template is covered automatically) with negative-fixture
 *      self-tests proving the detector catches CJK and clears English;
 *   2. frozen `bug_report.yml` field-id set — the ids are the prefill and
 *      E2E contract (renaming one silently breaks the prefilled URL);
 *   3. prefill value contract — every dropdown value `feedbackLink.js` can
 *      produce must exist byte-for-byte among the form's options; GitHub
 *      silently drops a prefill value that matches no option.
 *
 * Deliberately out of scope: `.github/workflows/*` (internal comments only,
 * never rendered to users).
 *
 * RED-first calibration (2026-09-30): the scan cell failed with 29 lines
 * (bug_report.yml ×21, pull_request_template.md ×8) before the fix.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import {
  buildIssueUrl,
  detectBrowserFromUserAgent,
  mapServiceToIssueValue,
} from "../../src/lib/feedbackLink.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ISSUE_TEMPLATE_DIR = join(ROOT, ".github", "ISSUE_TEMPLATE");
const BUG_REPORT_PATH = join(ISSUE_TEMPLATE_DIR, "bug_report.yml");

/**
 * CJK text detector: Han (incl. Ext-A and compatibility ideographs), kana,
 * CJK punctuation/symbols, fullwidth/halfwidth forms. English typography
 * (em dashes, arrows, ellipses) is intentionally NOT flagged — the defect
 * class is CJK text, not non-ASCII bytes.
 */
const CJK_RE =
  /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF01-\uFF60\uFF66-\uFF9D]/;

/**
 * The user-facing GitHub surface: every issue-template file (dynamic, so a
 * newly added template is covered) + the PR template. Workflows excluded.
 */
function guardedFiles() {
  const templates = readdirSync(ISSUE_TEMPLATE_DIR)
    .map((name) => ".github/ISSUE_TEMPLATE/" + name)
    .sort();
  return [...templates, ".github/pull_request_template.md"];
}

/** CJK hit lines as "L<line>: <text>" strings (empty array = clean). */
function cjkLines(text) {
  const hits = [];
  text.split("\n").forEach((line, index) => {
    if (CJK_RE.test(line)) hits.push("L" + (index + 1) + ": " + line.trim().slice(0, 120));
  });
  return hits;
}

describe("GitHub templates — language (issue #121)", () => {
  it("covers the expected surface (the guard cannot silently scan nothing)", () => {
    const files = guardedFiles();
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(files).toContain(".github/ISSUE_TEMPLATE/bug_report.yml");
    expect(files).toContain(".github/pull_request_template.md");
  });

  it("no CJK in any user-facing GitHub template file", () => {
    const violations = [];
    for (const rel of guardedFiles()) {
      const hits = cjkLines(readFileSync(join(ROOT, rel), "utf8"));
      for (const hit of hits) violations.push(rel + " " + hit);
    }
    expect(violations).toEqual([]);
  });

  it("detector self-test: catches the original defect string, clears English labels", () => {
    // The exact label class that shipped in bug_report.yml (user report).
    expect(cjkLines("是否「按钮状态与实际不符」类问题（高级 QA 专项）").length).toBe(1);
    expect(cjkLines("Is this a button-state mismatch issue?").length).toBe(0);
  });

  it("detector self-test: flags CJK punctuation / fullwidth forms, clears English typography", () => {
    expect(cjkLines("Fullwidth colon： and comma，").length).toBe(1);
    expect(cjkLines("Em dash — / arrow → / ellipsis … are English-safe").length).toBe(0);
  });
});

describe("bug_report.yml — prefill contract (issue #121)", () => {
  // Parsed once: a YAML syntax error here fails every cell below.
  const form = parse(readFileSync(BUG_REPORT_PATH, "utf8"));

  /** Options of a dropdown field by its id ([] when missing — asserted below). */
  function dropdownOptions(id) {
    const field = form.body.find((entry) => entry.id === id);
    return field?.attributes?.options || [];
  }

  it("parses as a YAML issue form with a body array", () => {
    expect(Array.isArray(form.body)).toBe(true);
    expect(typeof form.name).toBe("string");
  });

  it("keeps the exact bug_report.yml field-id set (prefill + E2E contract)", () => {
    const EXPECTED_FIELD_IDS = [
      "description",
      "steps",
      "expected",
      "actual",
      "service",
      "extension-version",
      "browser",
      "os",
      "state-anomaly",
      "spa-site",
      "state-recover",
      "state-steps",
      "console",
      "screenshots",
      "additional",
    ];
    expect(form.body.map((field) => field.id)).toEqual(EXPECTED_FIELD_IDS);
  });

  it("every service value the extension can prefill exists byte-for-byte among the form options", () => {
    const options = dropdownOptions("service");
    // Extraction sanity: empty options would make the check below trivially pass.
    expect(options.length).toBeGreaterThan(0);

    const values = [
      mapServiceToIssueValue("google"),
      mapServiceToIssueValue("ai", "openai"),
      mapServiceToIssueValue("ai", "deepseek"),
      mapServiceToIssueValue("ai", "anthropic"),
      mapServiceToIssueValue("ai", "google-gemini"),
      mapServiceToIssueValue("ai", "openrouter"),
      mapServiceToIssueValue("ai"),
    ];
    // Every listed case must map to a concrete option ("" would be omitted from the URL).
    expect(values).not.toContain("");

    const missing = values.filter((value) => !options.includes(value));
    expect(missing).toEqual([]);
  });

  it("every browser value the extension can prefill exists byte-for-byte among the form options", () => {
    const options = dropdownOptions("browser");
    expect(options.length).toBeGreaterThan(0);

    // One UA fixture per mapper branch: Chrome / Edge / Firefox / Other.
    const values = [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0",
      "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    ].map((ua) => detectBrowserFromUserAgent(ua));
    expect(new Set(values).size).toBe(4);

    const missing = values.filter((value) => !options.includes(value));
    expect(missing).toEqual([]);
  });

  it("the prefilled URL targets the issue-form file that actually exists", () => {
    const url = new URL(buildIssueUrl({ version: "2.1.30" }));
    const template = url.searchParams.get("template");
    expect(template).toBe("bug_report.yml");
    expect(existsSync(join(ISSUE_TEMPLATE_DIR, template))).toBe(true);
  });
});
