/*
  Hard i18n check: no accidental Chinese (CJK) in src/.

  User-facing strings must go through src/_locales/. This check fails the build
  when CJK text appears in source files outside of the following exemptions:

    1. src/_locales/**            — the i18n data itself
    2. src/lib/languages.js       — built-in language-name dictionary
                                   (multilingual data, not UI strings)
    3. lines containing <译泽>     — the AI-translation XML protocol marker
                                   (protocol token, not a UI string)
    4. src/lib/ai/providerRegistry.js / providerModelPreview.js
                                   — provider/model display names (proper nouns,
                                     intentionally bilingual)
    5. explicit marker blocks:
         // i18n-allow-chinese:start
         ... lines with CJK that are intentional (e.g. legacy error-message
             normalization shims, explanatory comments with examples) ...
         // i18n-allow-chinese:end

  Usage:
    node scripts/check-no-chinese.js

  Exit code 1 when violations are found.
*/

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_DIR = path.join(ROOT, "src");

const CJK_RE = /[\u4E00-\u9FFF]/;
const EXEMPT_FILES = new Set([
  "src/lib/languages.js",
  "src/lib/ai/providerRegistry.js",
  "src/lib/ai/providerModelPreview.js",
]);
const ALLOW_MARKER = "i18n-allow-chinese";
const ALLOW_START = `// ${ALLOW_MARKER}:start`;
const ALLOW_END = `// ${ALLOW_MARKER}:end`;

function collectFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "_locales") continue; // exemption 1
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, out);
    } else if (/\.(js|html)$/.test(entry.name)) {
      out.push(full);
    }
  }
}

function main() {
  const files = [];
  collectFiles(SOURCE_DIR, files);

  const violations = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    if (EXEMPT_FILES.has(rel)) continue; // exemptions 2 & 4

    const lines = fs.readFileSync(file, "utf8").split("\n");
    let allowed = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith(ALLOW_START)) {
        allowed = true; // exemption 5
        continue;
      }
      if (trimmed.startsWith(ALLOW_END)) {
        allowed = false;
        continue;
      }
      if (!CJK_RE.test(line)) continue;
      if (allowed) continue;
      if (
        line.includes("<\u8BD1") || // <译
        line.includes("</\u8BD1") || // </译
        line.includes("\u8BD1\u6CFD") // 译泽
      ) {
        continue; // <译泽> AI-translation protocol markers (exemption 3)
      }
      violations.push(`${rel}:${i + 1}: ${trimmed.slice(0, 120)}`);
    }
  }

  if (violations.length > 0) {
    console.error("Found Chinese text in source files outside exemptions:");
    for (const v of violations) console.error("  " + v);
    console.error("");
    console.error(
      "User-facing strings must go through src/_locales/. " +
        "If the text is intentional (protocol markers, data dictionaries, " +
        "provider names, legacy shims), add it to an exemption in " +
        "scripts/check-no-chinese.js or wrap it in i18n-allow-chinese markers."
    );
    process.exit(1);
  }

  console.log("✅ No unexempted Chinese text found in src/.");
  process.exit(0);
}

main();
