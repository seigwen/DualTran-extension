/**
 * 静态守卫：options.html 中每个 `select.add` 的隐形覆盖层必须被 options.css 覆盖。
 *
 * 背景（issue #147 用户报告）：options 页的「添加」按钮通过一个绝对定位、
 * 透明（appearance:none; position:absolute; opacity:0）的原生 <select> 覆盖在
 * 按钮之上实现「点击按钮 → 弹出语言列表」。该透明化规则以 **id 枚举** 形式写在
 * options.css 中——新增 select 若忘记登记，会以 .add 的可见盒子（100×35 原生
 * 下拉）直接渲染出来，用户看到「不用点击就显示语言列表」的缺陷。
 *
 * 规则：两个集合必须双向相等——
 *   ① 每个 class 含 `add` 的 <select> id 必须出现在透明化规则的 id 列表中；
 *   ② 透明化规则中的每个 id 必须对应 options.html 里真实存在的 select.add
 *     （防改名后残留幽灵选择器）。
 *
 * 这是「id 枚举式 CSS」的结构性补丁：枚举会随新增漏项，守卫把漏项变成硬失败。
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

const HTML_PATH = resolve(ROOT, "src/options/options.html");
const CSS_PATH = resolve(ROOT, "src/options/options.css");

/** 抽取 options.html 中所有 `select` 且 class 含 `add` 的元素的 id。 */
function collectSelectAddIds(html) {
  const ids = [];
  const tagRe = /<select\b[^>]*>/gi;
  for (const match of html.matchAll(tagRe)) {
    const tag = match[0];
    const classMatch = tag.match(/\bclass="([^"]*)"/i);
    if (!classMatch) continue;
    const classes = classMatch[1].split(/\s+/);
    if (!classes.includes("add")) continue;
    const idMatch = tag.match(/\bid="([^"]*)"/i);
    if (!idMatch) continue;
    ids.push(idMatch[1]);
  }
  return ids;
}

/**
 * 抽取 options.css 中「透明化覆盖层」规则的 id 列表。
 * 定位方式：规则体同时含 `appearance` 与 `opacity: 0`（见 options.css 头部注释
 * 所述语义——隐形 select 覆盖在 Add 按钮上）。
 */
function collectOverlayRuleIds(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = match[1].trim();
    const body = match[2];
    const isOverlayRule = body.includes("appearance") && /opacity\s*:\s*0/.test(body);
    if (!isOverlayRule) continue;
    return {
      selector,
      ids: [...selector.matchAll(/#([\w-]+)/g)].map((m) => m[1]),
    };
  }
  return { selector: "", ids: [] };
}

describe("options Add-button select overlay coverage (issue #147)", () => {
  const html = readFileSync(HTML_PATH, "utf-8");
  const css = readFileSync(CSS_PATH, "utf-8");

  it("locates the overlay rule and the select.add ids (sanity)", () => {
    const overlay = collectOverlayRuleIds(css);
    const selectIds = collectSelectAddIds(html);
    expect(overlay.selector.length).toBeGreaterThan(0);
    expect(overlay.ids.length).toBeGreaterThan(0);
    expect(selectIds.length).toBeGreaterThan(0);
  });

  it("every select.add id is registered in the overlay rule (no visibly-rendered select)", () => {
    const missing = collectSelectAddIds(html).filter(
      (id) => !collectOverlayRuleIds(css).ids.includes(id)
    );
    expect(
      missing,
      `select.add id(s) missing from the options.css overlay rule: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("the overlay rule lists no ghost ids (every registered id exists in options.html)", () => {
    const selectIds = collectSelectAddIds(html);
    const ghosts = collectOverlayRuleIds(css).ids.filter((id) => !selectIds.includes(id));
    expect(
      ghosts,
      `overlay rule lists select id(s) absent from options.html: ${ghosts.join(", ")}`
    ).toEqual([]);
  });
});
