/*
  L1 write-site guard: user-visible strings must come from src/_locales/ (i18n),
  never from hardcoded literals written straight into the UI.

  This is the mirror direction of check-no-chinese.js: that script bans hardcoded
  Chinese; this script bans hardcoded non-Chinese user-visible text at JS write
  sites (the defect class behind #155 — "OpenAI API Key" style hardcoded labels).

  Rules:
    R1   write-site literals — string / template literals assigned to
         user-visible surfaces (textContent / innerText / title / placeholder /
         document.title / setAttribute(title|placeholder|aria-label) /
         alert|confirm|prompt / insertAdjacentText / contextMenus title /
         Toastify text / new Option) must be produced by an i18n wrapper call,
         be lexically non-text (numbers / symbols / URLs / emails / CSS-code),
         be a "||" / ternary fallback value, or carry an explicit exemption
         marker.
    R1b  innerHTML templates — literal HTML assigned to innerHTML /
         insertAdjacentHTML must not contain hardcoded visible text, unless the
         template carries data-i18n* wiring (then R3 applies at file level).
    R2   key reference integrity — message keys used in getMessage-family calls
         and in data-i18n* attributes must exist in src/_locales/en/messages.json
         (case-insensitive — chrome.i18n.getMessage lookup is case-insensitive).
         Concatenated keys need a registered prefix allowlist. Orphan en keys
         (mentioned nowhere in src/ outside _locales) are warnings only.
    R3   dead data-i18n bindings — a JS file that writes data-i18n* bindings
         inside HTML fragments must also call translateDocument() somewhere in
         that file; otherwise the binding never runs and the English default
         text sticks (file-level heuristic; runtime timing itself is verified by
         the i18n sentinel scenario).

  Exemptions:
    // i18n-exempt: <category> — <note>     (category: legacy | data | platform | other)
    Same line (trailing comment) or a contiguous comment block directly above.
    Block form for template interiors / multi-element regions:
      // i18n-exempt: <category>:start — <note>   ...   // i18n-exempt:end
      <!-- i18n-exempt: <category>:start — <note> --> ... <!-- i18n-exempt:end -->
    `legacy` marks are counted in the summary and must be burned down (spec 47).

  Integration (planned, spec 47 P3): channel attribution via tests/shared/i18n-channels.mjs.

  Usage:
    node scripts/check-i18n-writes.js [--dir <sourceDir>]

  Exit code 1 when violations are found.
*/

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const dirArgIdx = args.indexOf("--dir");
const SOURCE_DIR = dirArgIdx >= 0 ? path.resolve(args[dirArgIdx + 1]) : path.join(ROOT, "src");
const EN_MESSAGES_PATH = path.join(ROOT, "src", "_locales", "en", "messages.json");
const MANIFEST_PATH = path.join(ROOT, "src", "manifest.json");

const CJK_RE = /[\u4E00-\u9FFF]/;
const LETTER_RE = /[A-Za-z]{2,}/;
const EXEMPT_RE = /(?:\/\/|<!--)\s*i18n-exempt:\s*(legacy|data|platform|other)\b/;
const EXEMPT_ANY_RE = /(?:\/\/|<!--)\s*i18n-exempt:/;
const BLOCK_START_RE = /(?:\/\/|<!--)\s*i18n-exempt:\s*(legacy|data|platform|other):start\b/;
const BLOCK_END_RE = /(?:\/\/|<!--)\s*i18n-exempt:end\b/;

// --- i18n wrapper calls (keep in sync with src i18n helpers) ---------------
const WRAPPER_NAMES = [
  "chrome.i18n.getMessage",
  "getMessage",
  "i18nOrDefault",
  "getMessageWithFallback",
  "getFloatingButtonGoogleTooltipText",
  "getFloatingButtonAiTooltipText",
  "getFloatingButtonOriginalTooltipText",
  "getFloatingButtonMoreOptionsText",
  "getAiImproveTranslationTooltipText",
];
function isWrapperCallee(name) {
  if (!name) return false;
  return WRAPPER_NAMES.some((w) => name === w || name.endsWith("." + w));
}

// --- write sites ------------------------------------------------------------
// kind "assign": the RHS expression is expected to be a localized value.
// kind "innerhtml": the RHS is an HTML fragment — visible text checked after
//                   stripping tags; data-i18n-wired templates defer to R3.
const WRITE_SITE_PATTERNS = [
  { re: /\.(?:textContent|innerText|placeholder|title)\s*=(?!=)/, kind: "assign" },
  { re: /document\.title\s*=(?!=)/, kind: "assign" },
  {
    re: /\.setAttribute\(\s*["'](?:title|placeholder|aria-label)["']\s*,/,
    kind: "assign",
  },
  { re: /\.insertAdjacentText\(\s*[^,]+,\s*/, kind: "assign" },
  { re: /\b(?:alert|confirm|prompt)\(\s*/, kind: "assign" },
  { re: /\bnew Option\(\s*/, kind: "assign" },
  { re: /\.innerHTML\s*=(?!=)/, kind: "innerhtml" },
  { re: /\.insertAdjacentHTML\(\s*[^,]+,\s*/, kind: "innerhtml" },
];

// Block scans: object-argument call sites whose title/text fields are user-visible.
const BLOCK_CALL_PATTERNS = [
  { re: /chrome\.contextMenus\.(?:create|update)\s*\(/, fields: ["title"] },
  { re: /\bToastify\s*\(/, fields: ["text", "title"] },
];

const NON_TEXT_PATTERNS = [
  /^(?:https?:\/\/|mailto:)\S*$/i, // URL-only
  /^[\w.+-]+@[\w.-]+$/, // email-only
];

const KEY_PREFIX_ALLOWLIST = ["hotkeyError_"];

// ---------------------------------------------------------------------------
// helpers

function collectFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "_locales") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (/\.(js|html)$/.test(entry.name)) out.push(full);
  }
}

/**
 * Blank out comment characters while preserving string/template contents and
 * line structure (newlines kept). Returns a same-length maskable copy.
 */
function maskJsComments(content) {
  const out = content.split("");
  let i = 0;
  const n = content.length;
  let mode = "code"; // code | dq | sq | tpl | line | block
  while (i < n) {
    const c = content[i];
    const c2 = content[i + 1];
    if (mode === "code") {
      if (c === "/" && c2 === "/") {
        mode = "line";
        i += 2;
        continue;
      }
      if (c === "/" && c2 === "*") {
        mode = "block";
        i += 2;
        continue;
      }
      if (c === '"') mode = "dq";
      else if (c === "'") mode = "sq";
      else if (c === "`") mode = "tpl";
    } else if (mode === "dq" || mode === "sq") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if ((mode === "dq" && c === '"') || (mode === "sq" && c === "'")) mode = "code";
    } else if (mode === "tpl") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") mode = "code";
    } else if (mode === "line") {
      if (c === "\n") mode = "code";
      else out[i] = " ";
    } else if (mode === "block") {
      if (c === "*" && c2 === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        mode = "code";
        continue;
      }
      if (c !== "\n") out[i] = " ";
    }
    i++;
  }
  return out.join("");
}

/** Mask HTML comments (keep newlines). */
function maskHtmlComments(content) {
  return content.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
}

function computeBlockRanges(rawLines) {
  const ranges = [];
  let open = null;
  for (let i = 0; i < rawLines.length; i++) {
    const start = BLOCK_START_RE.exec(rawLines[i]);
    if (start && !open) {
      open = { from: i, category: start[1] };
      continue;
    }
    if (BLOCK_END_RE.test(rawLines[i]) && open) {
      ranges.push({ from: open.from, to: i, category: open.category });
      open = null;
    }
  }
  if (open) ranges.push({ from: open.from, to: rawLines.length - 1, category: open.category });
  return ranges;
}

function hasExemption(rawLines, idx, blockRanges) {
  if (blockRanges && blockRanges.some((r) => idx >= r.from && idx <= r.to)) return true;
  if (EXEMPT_ANY_RE.test(rawLines[idx] || "")) return true; // same line
  // walk up through a contiguous comment / blank block directly above
  for (let i = idx - 1; i >= 0 && i >= idx - 4; i--) {
    const line = rawLines[i];
    const t = line.trim();
    if (t === "") continue;
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("<!--")) {
      if (EXEMPT_ANY_RE.test(line)) return true;
      continue;
    }
    break;
  }
  return false;
}

/**
 * Lex a JS expression (RHS of a write site) producing:
 *   items: [{ text, start, wrapper, skipDepth, isChunk }]
 *   - wrapper:    literal sits inside an i18n wrapper call's arguments
 *   - skipDepth:  number of enclosing call/bracket frames (data-arg depth)
 *   - isChunk:    static text chunk of a template literal (vs quoted string)
 * Call parens and `[` brackets count as skip frames; grouping parens, `{`
 * braces and `${...}` template substitutions are transparent.
 */
function lexRhs(s) {
  const items = [];
  const stack = []; // frames: {kind:'paren',wrapper} | {kind:'brk'} | {kind:'brace'} | {kind:'sub'} | {kind:'tpl'}
  let i = 0;
  const n = s.length;
  let chunkStart = -1;

  function skipDepthNow() {
    let d = 0;
    for (const f of stack) if (f.kind === "paren" || f.kind === "brk") d++;
    return d;
  }
  function wrapperNow() {
    return stack.some((f) => f.kind === "paren" && f.wrapper);
  }
  function pushItem(text, start, isChunk) {
    if (text.trim() === "") return;
    items.push({ text, start, isChunk, wrapper: wrapperNow(), skipDepth: skipDepthNow() });
  }
  function calleeBefore(pos) {
    let j = pos - 1;
    while (j >= 0 && /\s/.test(s[j])) j--;
    let end = j;
    while (j >= 0 && /[\w$.]/.test(s[j])) j--;
    return s.slice(j + 1, end + 1);
  }
  function flushChunk(endExclusive) {
    if (chunkStart >= 0) {
      pushItem(s.slice(chunkStart, endExclusive), chunkStart, true);
      chunkStart = -1;
    }
  }

  while (i < n) {
    const c = s[i];
    const inTpl = stack.length > 0 && stack[stack.length - 1].kind === "tpl";
    if (inTpl) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "$" && s[i + 1] === "{") {
        flushChunk(i);
        stack.push({ kind: "sub" });
        i += 2;
        continue;
      }
      if (c === "`") {
        flushChunk(i);
        stack.pop();
        i++;
        continue;
      }
      i++;
      continue;
    }
    // code mode
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let text = "";
      while (j < n) {
        const d = s[j];
        if (d === "\\") {
          text += s[j] + (s[j + 1] || "");
          j += 2;
          continue;
        }
        if (d === quote) break;
        text += d;
        j++;
      }
      pushItem(text, i, false);
      i = j + 1;
      continue;
    }
    if (c === "`") {
      stack.push({ kind: "tpl" });
      chunkStart = i + 1;
      i++;
      continue;
    }
    if (c === "(") {
      stack.push({ kind: "paren", wrapper: isWrapperCallee(calleeBefore(i)) });
      i++;
      continue;
    }
    if (c === ")") {
      if (stack.length && stack[stack.length - 1].kind === "paren") stack.pop();
      i++;
      continue;
    }
    if (c === "[") {
      stack.push({ kind: "brk" });
      i++;
      continue;
    }
    if (c === "]") {
      if (stack.length && stack[stack.length - 1].kind === "brk") stack.pop();
      i++;
      continue;
    }
    if (c === "{") {
      stack.push({ kind: "brace" });
      i++;
      continue;
    }
    if (c === "}") {
      if (stack.length && stack[stack.length - 1].kind === "brace") stack.pop();
      else if (stack.length && stack[stack.length - 1].kind === "sub") {
        stack.pop();
        // back inside template: restart chunk accumulation
        chunkStart = i + 1;
      }
      i++;
      continue;
    }
    i++;
  }
  // unclosed template at end
  if (stack.length && stack[stack.length - 1].kind === "tpl") flushChunk(n);
  return items;
}

/** Gather the RHS starting at (lineIdx, col); stop at end-of-line once quote /
 *  template / call states are balanced. Bounded at 60 lines. */
function gatherRhs(lines, lineIdx, col) {
  let acc = "";
  for (let i = lineIdx; i < lines.length && i < lineIdx + 60; i++) {
    const line = i === lineIdx ? lines[i].slice(col) : lines[i];
    acc += (i === lineIdx ? "" : "\n") + line;
    const { balanced } = lexBalanced(acc);
    if (balanced && i >= lineIdx) {
      if (i > lineIdx) return acc;
      // same line: also stop at first top-level `;` if present
      const cut = findTopLevelSemicolon(acc);
      return cut >= 0 ? acc.slice(0, cut) : acc;
    }
  }
  return acc;
}

function lexBalanced(s) {
  let depth = 0;
  let mode = "code";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (mode === "code") {
      if (c === '"') mode = "dq";
      else if (c === "'") mode = "sq";
      else if (c === "`") mode = "tpl";
      else if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
    } else if (mode === "dq" || mode === "sq") {
      if (c === "\\") i++;
      else if ((mode === "dq" && c === '"') || (mode === "sq" && c === "'")) mode = "code";
    } else if (mode === "tpl") {
      if (c === "\\") i++;
      else if (c === "`") mode = "code";
    }
  }
  return { balanced: mode === "code" && depth <= 0 };
}

function findTopLevelSemicolon(s) {
  let depth = 0;
  let mode = "code";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (mode === "code") {
      if (c === '"') mode = "dq";
      else if (c === "'") mode = "sq";
      else if (c === "`") mode = "tpl";
      else if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      else if (c === ";" && depth === 0) return i;
    } else if (mode === "dq" || mode === "sq") {
      if (c === "\\") i++;
      else if ((mode === "dq" && c === '"') || (mode === "sq" && c === "'")) mode = "code";
    } else if (mode === "tpl") {
      if (c === "\\") i++;
      else if (c === "`") mode = "code";
    }
  }
  return -1;
}

/** Classify a literal as a hardcoded-text candidate, or null to skip. */
function classifyLiteral(lit, rhs, lines, rawLines, lineIdx, blockRanges) {
  const text = lit.text;
  const t = text.trim();
  if (t === "") return null;
  if (CJK_RE.test(text)) return null; // delegated to check-no-chinese.js
  if (!LETTER_RE.test(text)) return null;
  if (/[{}]/.test(text)) return null; // CSS / object-literal code
  if (NON_TEXT_PATTERNS.some((re) => re.test(t))) return null;
  const prefix = rhs.slice(0, lit.start);
  if (/(?:\|\||\?\?)\s*$/.test(prefix)) return null; // fallback position
  if (/([A-Za-z_$][\w$]*)\s*\?\s*\1\s*:\s*$/.test(prefix)) return null; // ident ? ident : lit
  if (hasExemption(rawLines, lineIdx, blockRanges)) return null;
  return t;
}

// ---------------------------------------------------------------------------
function main() {
  const files = [];
  collectFiles(SOURCE_DIR, files);

  const enKeys = JSON.parse(fs.readFileSync(EN_MESSAGES_PATH, "utf8"));
  const keySetExact = new Set(Object.keys(enKeys));
  const keySetLower = new Set([...keySetExact].map((k) => k.toLowerCase()));

  const violations = [];
  const concatPrefixes = [];
  const usedLower = new Set();
  const corpusParts = [];
  let legacyExemptCount = 0;
  let otherExemptCount = 0;

  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    const isJs = rel.endsWith(".js");
    const content = fs.readFileSync(file, "utf8");
    const masked = isJs ? maskJsComments(content) : maskHtmlComments(content);
    const rawLines = content.split("\n");
    const scanLines = masked.split("\n");
    const blockRanges = computeBlockRanges(rawLines);
    corpusParts.push(content);

    // count exemptions (from raw content)
    legacyExemptCount += (content.match(/(?:\/\/|<!--)\s*i18n-exempt:\s*legacy\b/g) || []).length;
    otherExemptCount += (content.match(/(?:\/\/|<!--)\s*i18n-exempt:\s*(?:data|platform|other)\b/g) || []).length;

    // ---------- R2: key references ----------
    const keyCallRe =
      /(?:chrome\.i18n\.getMessage|getMessage|i18nOrDefault|getMessageWithFallback)\(\s*(["'`])([^"'`$]+)\1\s*(\+)?/g;
    let m;
    while ((m = keyCallRe.exec(masked)) !== null) {
      if (m[3] === "+") continue; // concatenation — handled below
      const key = m[2];
      const lineNo = masked.slice(0, m.index).split("\n").length;
      if (hasExemption(rawLines, lineNo - 1, blockRanges)) {
        usedLower.add(key.toLowerCase());
        continue;
      }
      if (!keySetLower.has(key.toLowerCase())) {
        violations.push(
          `${rel}:${lineNo} [R2] message key "${key}" not found in en/messages.json`
        );
      } else {
        usedLower.add(key.toLowerCase());
      }
    }
    const concatRe =
      /(?:chrome\.i18n\.getMessage|getMessage|i18nOrDefault|getMessageWithFallback)\(\s*(["'])([A-Za-z0-9_]+)\1\s*\+/g;
    while ((m = concatRe.exec(masked)) !== null) {
      const prefix = m[2];
      const lineNo = masked.slice(0, m.index).split("\n").length;
      concatPrefixes.push({ prefix });
      if (!KEY_PREFIX_ALLOWLIST.includes(prefix)) {
        violations.push(
          `${rel}:${lineNo} [R2] concatenated message key with prefix "${prefix}" is not in the prefix allowlist`
        );
      }
    }
    const attrRe = /data-i18n(?:-(?:title|placeholder|label))?\s*=\s*(["'`])([^"'`$]+)\1/g;
    while ((m = attrRe.exec(masked)) !== null) {
      const key = m[2];
      const lineNo = masked.slice(0, m.index).split("\n").length;
      if (hasExemption(rawLines, lineNo - 1, blockRanges)) {
        usedLower.add(key.toLowerCase());
        continue;
      }
      if (!keySetLower.has(key.toLowerCase())) {
        violations.push(`${rel}:${lineNo} [R2] data-i18n key "${key}" not found in en/messages.json`);
      } else {
        usedLower.add(key.toLowerCase());
      }
    }
    if (!isJs) continue;

    // ---------- R1 / R1b: write-site literals ----------
    for (let i = 0; i < scanLines.length; i++) {
      const line = scanLines[i];
      if (line.trim() === "") continue;

      // collect all site matches on this line, process non-overlapping ones
      const matches = [];
      for (const site of WRITE_SITE_PATTERNS) {
        const re = new RegExp(site.re.source, "g");
        let sm;
        while ((sm = re.exec(line)) !== null) {
          matches.push({ site, index: sm.index, end: sm.index + sm[0].length });
        }
      }
      matches.sort((a, b) => a.index - b.index);
      let lastEnd = -1;
      for (const mm of matches) {
        if (mm.index < lastEnd) continue;
        lastEnd = mm.end;
        const rhs = gatherRhs(scanLines, i, mm.end);
        const items = lexRhs(rhs);
        const top = items.filter((it) => it.skipDepth === 0 && !it.wrapper);
        if (mm.site.kind === "innerhtml") {
          const joined = top.map((it) => it.text).join("\n");
          if (/data-i18n/.test(joined)) continue; // wired template → R3 file-level
          const stripped = joined
            .replace(/<!--[\s\S]*?-->/g, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<[^>]*>/g, " ")
            .replace(/&[a-zA-Z]+;|&#\d+;/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          if (/[{}]/.test(stripped)) continue; // CSS-only fragment (e.g. style.innerHTML)
          if (LETTER_RE.test(stripped) && !hasExemption(rawLines, i, blockRanges)) {
            violations.push(
              `${rel}:${i + 1} [R1b] innerHTML template contains hardcoded visible text: "${stripped.slice(0, 80)}"`
            );
          }
        } else {
          for (const it of top) {
            const cand = classifyLiteral(it, rhs, scanLines, rawLines, i, blockRanges);
            if (cand !== null) {
              violations.push(
                `${rel}:${i + 1} [R1] write-site literal is not i18n: "${cand.slice(0, 80)}"`
              );
            }
          }
        }
      }

      // ---------- R1: block-call fields (contextMenus / Toastify) ----------
      for (const block of BLOCK_CALL_PATTERNS) {
        const bm = block.re.exec(line);
        if (!bm) continue;
        const { endLine } = findBlockEnd(scanLines, i, bm.index);
        for (let k = i; k <= endLine && k < scanLines.length; k++) {
          for (const field of block.fields) {
            const fre = new RegExp(`\\b${field}\\s*:\\s*(.+)$`);
            const fm = fre.exec(scanLines[k]);
            if (!fm) continue;
            const rhs = fm[1];
            if (hasExemption(rawLines, k, blockRanges)) continue;
            const items = lexRhs(rhs).filter((it) => it.skipDepth === 0 && !it.wrapper);
            for (const it of items) {
              const cand = classifyLiteral(it, rhs, scanLines, rawLines, k, blockRanges);
              if (cand !== null) {
                violations.push(
                  `${rel}:${k + 1} [R1] ${field} literal is not i18n: "${cand.slice(0, 80)}"`
                );
              }
            }
          }
        }
        break;
      }
    }

    // ---------- R3: dead data-i18n bindings ----------
    // Attribute-form bindings only (`data-i18n*=` written into HTML fragments);
    // `[data-i18n=...]` selector strings are not bindings.
    const r3AttrRe = /(?<!\[)data-i18n(?:-(?:title|placeholder|label))?\s*=/g;
    const hasTranslateDoc = /translateDocument\s*\(/.test(masked);
    if (!hasTranslateDoc) {
      for (let i = 0; i < scanLines.length; i++) {
        const line = scanLines[i];
        r3AttrRe.lastIndex = 0;
        if (!r3AttrRe.test(line)) continue;
        const window = scanLines.slice(Math.max(0, i - 2), i + 3).join(" ");
        if (!/<[a-zA-Z/!]/.test(window)) continue;
        if (hasExemption(rawLines, i, blockRanges)) continue;
        violations.push(
          `${rel}:${i + 1} [R3] data-i18n binding written here but no translateDocument() exists in this file`
        );
      }
    }
  }

  // ---------- orphan keys (warn only) ----------
  let manifestContent = "";
  try {
    manifestContent = fs.readFileSync(MANIFEST_PATH, "utf8");
  } catch (_) {}
  corpusParts.push(manifestContent);
  const corpus = corpusParts.join("\n");
  const msgRe = /__MSG_([A-Za-z0-9_]+)__/g;
  let mm2;
  while ((mm2 = msgRe.exec(manifestContent)) !== null) usedLower.add(mm2[1].toLowerCase());
  for (const { prefix } of concatPrefixes) {
    for (const key of keySetExact) if (key.startsWith(prefix)) usedLower.add(key.toLowerCase());
  }
  const orphans = [];
  for (const key of keySetExact) {
    if (usedLower.has(key.toLowerCase())) continue;
    const re = new RegExp("\\b" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
    if (!re.test(corpus)) orphans.push(key);
  }

  // ---------- report ----------
  const seen = new Set();
  const deduped = violations.filter((v) => {
    if (seen.has(v)) return false;
    seen.add(v);
    return true;
  });
  deduped.sort();

  if (deduped.length > 0) {
    console.error(`i18n write-site violations found (${deduped.length}):`);
    for (const v of deduped) console.error("  " + v);
    console.error("");
    console.error(
      "User-visible strings must go through src/_locales/. If a literal is intentional " +
        "(data / platform constraint / legacy), add `// i18n-exempt: <category> — <note>` " +
        "on the statement line or the line above it."
    );
  }

  if (orphans.length > 0) {
    console.warn(
      `⚠️  orphan en keys (mentioned nowhere outside _locales — warn only, ${orphans.length}):`
    );
    for (const k of orphans) console.warn("   - " + k);
  }

  const summary = {
    total: deduped.length,
    r1: deduped.filter((v) => v.includes("[R1]")).length,
    r1b: deduped.filter((v) => v.includes("[R1b]")).length,
    r2: deduped.filter((v) => v.includes("[R2]")).length,
    r3: deduped.filter((v) => v.includes("[R3]")).length,
    orphans: orphans.length,
    exemptionsLegacy: legacyExemptCount,
    exemptionsOther: otherExemptCount,
  };
  console.log("summary:", JSON.stringify(summary));

  if (deduped.length > 0) process.exit(1);
  console.log("✅ No i18n write-site violations found.");
  process.exit(0);
}

function findBlockEnd(lines, lineIdx, colIdx) {
  let depth = 0;
  let started = false;
  for (let i = lineIdx; i < lines.length && i < lineIdx + 200; i++) {
    const line = i === lineIdx ? lines[i].slice(colIdx) : lines[i];
    for (const c of line) {
      if (c === "(") {
        depth++;
        started = true;
      } else if (c === ")") {
        depth--;
        if (started && depth === 0) return { endLine: i };
      }
    }
  }
  return { endLine: Math.min(lines.length - 1, lineIdx + 200) };
}

main();
