/**
 * #171 — blockBtnGroupBadge 单元测试（常驻控件）。
 *
 * 覆盖：锚点规则（newLine = <translated> 前 / replaceOriginal = 块末尾）、
 * 幂等与换型、清理、无障碍属性、点击回调与事件屏蔽（stopPropagation +
 * preventDefault）、反查（resolveBlockForControl）、intentMode 上色。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  injectBlockBadgeStyles,
  upsertBlockBadge,
  removeBlockBadge,
  removeAllBlockBadges,
  resolveBlockForControl,
  setBlockBadgeCallbacks,
  syncBlockBadgeActiveState,
} from "../../src/contentScript/blockBtnGroupBadge.js";

describe("blockBtnGroupBadge — 常驻控件（#171）", () => {
  let blockEl;

  const asHex = (v) => {
    const m = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(v || "");
    return m ? "#" + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, "0")).join("") : (v || "").toLowerCase();
  };
  const badges = () => document.querySelectorAll(".dualtran-block-badge");
  const rows = () => document.querySelectorAll(".dualtran-block-btn-row");

  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    setBlockBadgeCallbacks(null);
    blockEl = document.createElement("translated");
    blockEl.textContent = "Bonjour";
    document.body.appendChild(blockEl);
  });

  afterEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    setBlockBadgeCallbacks(null);
  });

  test("newLine 块：徽标注入到 <translated> 之前（原文行末锚点）", () => {
    upsertBlockBadge(blockEl, "badge");
    expect(badges().length).toBe(1);
    expect(blockEl.previousSibling).toBe(badges()[0]);
  });

  test("replaceOriginal 块：徽标 append 到块元素末尾", () => {
    document.body.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = "Hello";
    document.body.appendChild(p);
    upsertBlockBadge(p, "badge");
    expect(badges().length).toBe(1);
    expect(p.lastChild).toBe(badges()[0]);
  });

  test("幂等：同型重复 upsert 不产生第二个控件", () => {
    upsertBlockBadge(blockEl, "badge");
    upsertBlockBadge(blockEl, "badge");
    expect(badges().length).toBe(1);
  });

  test("换型：badge ↔ buttons 是替换而非叠加", () => {
    upsertBlockBadge(blockEl, "badge");
    upsertBlockBadge(blockEl, "buttons");
    expect(badges().length).toBe(0);
    expect(rows().length).toBe(1);

    upsertBlockBadge(blockEl, "badge");
    expect(badges().length).toBe(1);
    expect(rows().length).toBe(0);
  });

  test("removeBlockBadge / removeAllBlockBadges 清理", () => {
    upsertBlockBadge(blockEl, "badge");
    removeBlockBadge(blockEl);
    expect(badges().length).toBe(0);

    upsertBlockBadge(blockEl, "buttons");
    removeAllBlockBadges();
    expect(rows().length).toBe(0);
  });

  test("徽标无障碍与提示：role / aria-label / title（i18n）", () => {
    upsertBlockBadge(blockEl, "badge");
    const badge = badges()[0];
    expect(badge.getAttribute("role")).toBe("button");
    expect(badge.title).toBe("Paragraph translation options");
    expect(badge.getAttribute("aria-label")).toBe("Paragraph translation options");
    expect(badge.classList.contains("notranslate")).toBe(true);
  });

  test("徽标点击 → onBadgeClick(badge, block)；阻止冒泡与默认行为", () => {
    const spy = vi.fn();
    setBlockBadgeCallbacks({ onBadgeClick: spy });
    upsertBlockBadge(blockEl, "badge");
    const badge = badges()[0];
    const docListener = vi.fn();
    document.addEventListener("click", docListener);
    const notCanceled = badge.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    document.removeEventListener("click", docListener);
    expect(spy).toHaveBeenCalledWith(badge, blockEl);
    expect(notCanceled).toBe(false); // preventDefault 生效（dispatchEvent 返回 false）
    expect(docListener).not.toHaveBeenCalled(); // stopPropagation 生效
  });

  test("内联按钮点击 → onInlineButtonClick(buttonId, block)", () => {
    const spy = vi.fn();
    setBlockBadgeCallbacks({ onInlineButtonClick: spy });
    upsertBlockBadge(blockEl, "buttons");
    rows()[0].querySelector('[data-button-id="google"]').click();
    expect(spy).toHaveBeenCalledWith("google", blockEl);
  });

  test("resolveBlockForControl：徽标 / 行 / 行内按钮均可反查到块；非我方元素为 null", () => {
    upsertBlockBadge(blockEl, "badge");
    expect(resolveBlockForControl(badges()[0])).toBe(blockEl);

    upsertBlockBadge(blockEl, "buttons");
    const row = rows()[0];
    expect(resolveBlockForControl(row)).toBe(blockEl);
    expect(resolveBlockForControl(row.querySelector('[data-button-id="ai"]'))).toBe(blockEl);
    expect(resolveBlockForControl(document.body)).toBeNull();
  });

  test("syncBlockBadgeActiveState：按 intentMode 上色（active/inactive 逐字色板）", () => {
    upsertBlockBadge(blockEl, "buttons");
    syncBlockBadgeActiveState(blockEl, "ai");
    const row = rows()[0];
    const aiBtn = row.querySelector('[data-button-id="ai"]');
    const gBtn = row.querySelector('[data-button-id="google"]');
    expect(asHex(aiBtn.style.background)).toBe("#7c3aed");
    expect(asHex(gBtn.style.background)).toBe("#eff6ff");
    expect(aiBtn.classList.contains("dualtran-btn-active")).toBe(true);

    syncBlockBadgeActiveState(blockEl, "google");
    expect(asHex(gBtn.style.background)).toBe("#1d4ed8");
    expect(aiBtn.classList.contains("dualtran-btn-active")).toBe(false);
  });

  test("样式注入幂等（单一 style 元素）", () => {
    injectBlockBadgeStyles();
    injectBlockBadgeStyles();
    expect(document.querySelectorAll("#dualtran-block-badge-style").length).toBe(1);
  });
});
