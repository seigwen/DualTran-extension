/**
 * Visual assertions for Phase 3 (plan 2026-11-27_phase3-visual-programmatization).
 *
 * Every check is mechanical and reports through one of three statuses:
 *   - pass  → console.log  [visual-assert]
 *   - warn  → console.warn [visual-warn]   (never red; used for calibration)
 *   - fail  → throw                        (hard, or warn in VISUAL_ASSERT_MODE=warn)
 *
 * `VISUAL_ASSERT_MODE=warn` downgrades every hard failure to a warning for the
 * three-clean-run calibration. `unknown` is never downgraded: a missing element
 * or an unreadable DOM is a hole in the evidence, not a pass.
 */

import { assertNoDuplicateTranslations } from "./setup.mjs";

const AI_SELECTOR = ".dualtran-ai, .dualtran-aitranslatedtext-replacemode";
const GOOGLE_SELECTOR = ".dualtran-google";
const FLOATING_ACTIVE = ".dualtran-floating-btn-active";
const SINGLETON_ACTIVE = ".dualtran-btn-active";

const mode = () => (process.env.VISUAL_ASSERT_MODE || "hard").toLowerCase();

function pass(name, detail = "") {
  console.log(`[visual-assert] ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, message, severity = "hard") {
  const text = `${name}: ${message}`;
  if (severity === "warn" || mode() === "warn") {
    console.warn(`[visual-warn] ${text}`);
    return;
  }
  throw new Error(`[visual-assert] ${text}`);
}

function unknown(name, message) {
  throw new Error(`[visual-unknown] ${name}: ${message}`);
}

function visiblePageHelper() {
  // Kept as a string-free function so page.evaluate can serialize the call.
  const isVisible = (el) => {
    if (!el) return false;
    let node = el;
    while (node && node.nodeType === 1) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      node = node.parentElement;
    }
    return true;
  };
  return isVisible;
}

/** E1: visible AI text exists; color exactness stays with the AI reviewer. */
export async function assertAiVisibleWithAiColor(page) {
  const r = await page.evaluate((sel) => {
    const isVisible = (el) => {
      if (!el) return false;
      let node = el;
      while (node && node.nodeType === 1) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        node = node.parentElement;
      }
      return true;
    };
    const spans = [...document.querySelectorAll(sel)]
      .filter(isVisible)
      .filter((s) => (s.textContent || "").trim().length > 0);
    return {
      count: spans.length,
      text: (spans[0]?.textContent || "").trim().slice(0, 80),
      color: spans[0] ? getComputedStyle(spans[0]).color : "",
    };
  }, AI_SELECTOR);
  if (r.count === 0) unknown("assertAiVisibleWithAiColor", "no visible AI span with text");
  pass("assertAiVisibleWithAiColor", `${r.count} visible AI span(s), color=${r.color}`);
}

/** E2: no duplicate/stacked AI translation spans. */
export async function assertNoDuplicateTranslationBlocks(page) {
  try {
    await assertNoDuplicateTranslations(page);
    pass("assertNoDuplicateTranslationBlocks");
  } catch (err) {
    fail("assertNoDuplicateTranslationBlocks", err.message);
  }
}

/** E3: contrast warning only — effective background can be transparent/image. */
export async function assertContrastWarn(page) {
  const r = await page.evaluate((sel) => {
    const parse = (value) => {
      const nums = (value || "").match(/[\d.]+/g);
      return nums ? nums.map(Number) : null;
    };
    const lum = ([r, g, b]) => {
      const f = (c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const background = (el) => {
      let node = el;
      while (node && node.nodeType === 1) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c && (c.length < 4 || c[3] > 0)) return c.slice(0, 3);
        node = node.parentElement;
      }
      return [255, 255, 255];
    };
    const warnings = [];
    for (const el of document.querySelectorAll(sel)) {
      const text = (el.textContent || "").trim();
      if (!text) continue;
      let node = el;
      let visible = true;
      while (node && node.nodeType === 1) {
        const s = getComputedStyle(node);
        if (s.display === "none" || s.visibility === "hidden") { visible = false; break; }
        node = node.parentElement;
      }
      if (!visible) continue;
      const fg = parse(getComputedStyle(el).color);
      if (!fg) continue;
      const bg = background(el);
      const L1 = lum(fg.slice(0, 3));
      const L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      if (ratio < 3.0) warnings.push({ text: text.slice(0, 40), ratio: Number(ratio.toFixed(2)) });
    }
    return warnings;
  }, AI_SELECTOR);
  if (r.length) fail("assertContrastWarn", JSON.stringify(r.slice(0, 3)), "warn");
  else pass("assertContrastWarn");
}

/** E4: exactly one floating button active, and it is the expected id. */
export async function assertExactlyOneFloatingActive(page, expectedId = "btnAi") {
  const r = await page.evaluate(({ sel, id }) => {
    const host = document.getElementById("dualtran-floating-btn-host");
    if (!host?.shadowRoot) return { missing: true };
    const active = [...host.shadowRoot.querySelectorAll(sel)];
    return { count: active.length, ids: active.map((b) => b.id) };
  }, { sel: FLOATING_ACTIVE, id: expectedId });
  if (r.missing) unknown("assertExactlyOneFloatingActive", "floating host/shadow root missing");
  if (r.count !== 1 || r.ids[0] !== expectedId) {
    fail("assertExactlyOneFloatingActive", `active=${JSON.stringify(r.ids)} expected ${expectedId}`);
  } else pass("assertExactlyOneFloatingActive", expectedId);
}

/** E5: exactly one singleton button active, and it is the expected selector. */
export async function assertSingletonActiveOnly(page, selector) {
  const r = await page.evaluate(({ activeSel, targetSel }) => {
    const host = document.getElementById("dualtran-singleton-btn-host");
    if (!host?.shadowRoot) return { missing: true };
    const active = [...host.shadowRoot.querySelectorAll(activeSel)];
    const target = host.shadowRoot.querySelector(targetSel);
    return {
      count: active.length,
      classes: active.map((b) => b.className),
      targetActive: !!target && target.classList.contains("dualtran-btn-active"),
      background: target ? getComputedStyle(target).backgroundColor : "",
    };
  }, { activeSel: SINGLETON_ACTIVE, targetSel: selector });
  if (r.missing) unknown("assertSingletonActiveOnly", "singleton host/shadow root missing");
  if (r.count !== 1 || !r.targetActive) {
    fail("assertSingletonActiveOnly", `count=${r.count} classes=${JSON.stringify(r.classes)} targetActive=${r.targetActive}`);
    return;
  }
  if (r.background === "rgba(0, 0, 0, 0)" || r.background === "transparent") {
    fail("assertSingletonActiveOnly", `active button has transparent background (${r.background})`);
    return;
  }
  pass("assertSingletonActiveOnly", `${selector} ${r.background}`);
}

/** E6: Google/AI singleton buttons are not the active one. */
export async function assertSingletonInactive(page, selectors) {
  const r = await page.evaluate(({ activeSel, selectors }) => {
    const host = document.getElementById("dualtran-singleton-btn-host");
    if (!host?.shadowRoot) return { missing: true };
    return selectors.map((sel) => {
      const btn = host.shadowRoot.querySelector(sel);
      return { sel, exists: !!btn, active: !!btn && btn.classList.contains("dualtran-btn-active") };
    });
  }, { activeSel: SINGLETON_ACTIVE, selectors });
  if (r.missing) unknown("assertSingletonInactive", "singleton host/shadow root missing");
  const bad = r.filter((x) => !x.exists || x.active);
  if (bad.length) fail("assertSingletonInactive", JSON.stringify(bad));
  else pass("assertSingletonInactive", selectors.join(", "));
}

/** E7: the hovered block is back to original, other blocks keep AI. */
export async function assertHoveredBlockOriginal(page, blockIndex = 0) {
  const r = await page.evaluate(({ idx, aiSel, googleSel }) => {
    const isVisible = (el) => {
      if (!el) return false;
      let node = el;
      while (node && node.nodeType === 1) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        node = node.parentElement;
      }
      return true;
    };
    const blocks = [...document.querySelectorAll("[data-dualtran-block]")]
      .filter((el) => !el.closest("[data-e2e-fixture-hidden]"));
    const target = blocks[idx];
    if (!target) return { missing: true };
    const ai = target.querySelector(aiSel);
    const google = target.querySelector(googleSel);
    const aiVisible = !!ai && isVisible(ai) && !!ai.textContent.trim();
    const googleVisible = !!google && isVisible(google) && !!google.textContent.trim();
    const targetOriginal = !isVisible(target) || (!aiVisible && !googleVisible);
    const others = blocks
      .map((el, i) => {
        if (i === idx) return null;
        const s = el.querySelector(aiSel);
        return isVisible(el) && !!s && isVisible(s) && !!s.textContent.trim();
      })
      .filter((x) => x !== null);
    return { missing: false, targetOriginal, othersAllAi: others.every(Boolean), otherCount: others.length };
  }, { idx: blockIndex, aiSel: AI_SELECTOR, googleSel: GOOGLE_SELECTOR });
  if (r.missing) unknown("assertHoveredBlockOriginal", `block ${blockIndex} missing`);
  if (!r.targetOriginal || !r.othersAllAi) {
    fail("assertHoveredBlockOriginal", `targetOriginal=${r.targetOriginal} othersAllAi=${r.othersAllAi} (${r.otherCount})`);
  } else pass("assertHoveredBlockOriginal", `block ${blockIndex} original, ${r.otherCount} other block(s) AI`);
}

/** E8: floating group is anchored to the right edge. */
export async function assertFloatingRightEdge(page) {
  const r = await page.evaluate(() => {
    const host = document.getElementById("dualtran-floating-btn-host");
    if (!host) return { missing: true };
    // The shadow host itself can be a small/zero-size wrapper; the actual
    // right-anchored layer lives at #floatingBtnLayer inside the shadow root.
    const layer = host.shadowRoot?.getElementById("floatingBtnLayer") || host;
    const rect = layer.getBoundingClientRect();
    return { right: rect.right, innerWidth: window.innerWidth, width: rect.width };
  });
  if (r.missing) unknown("assertFloatingRightEdge", "floating host missing");
  if (Math.abs(r.innerWidth - r.right) > 20) {
    fail("assertFloatingRightEdge", `gap=${(r.innerWidth - r.right).toFixed(1)}px`);
  } else pass("assertFloatingRightEdge", `gap=${(r.innerWidth - r.right).toFixed(1)}px`);
}

/** E9: exactly one floating button active per state. */
export async function assertOneActivePerState(page, expectedId) {
  const r = await page.evaluate((sel) => {
    const host = document.getElementById("dualtran-floating-btn-host");
    if (!host?.shadowRoot) return { missing: true };
    const active = [...host.shadowRoot.querySelectorAll(sel)];
    return { count: active.length, ids: active.map((b) => b.id) };
  }, FLOATING_ACTIVE);
  if (r.missing) unknown("assertOneActivePerState", "floating host missing");
  if (r.count !== 1 || r.ids[0] !== expectedId) {
    fail("assertOneActivePerState", `active=${JSON.stringify(r.ids)} expected ${expectedId}`);
  } else pass("assertOneActivePerState", expectedId);
}

/** E10: no stale Google text in the final AI state. */
export async function assertNoStaleTranslation(page) {
  const r = await page.evaluate(({ aiSel, googleSel, activeSel }) => {
    const isVisible = (el) => {
      if (!el) return false;
      let node = el;
      while (node && node.nodeType === 1) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        node = node.parentElement;
      }
      return true;
    };
    const host = document.getElementById("dualtran-floating-btn-host");
    const active = host?.shadowRoot ? [...host.shadowRoot.querySelectorAll(activeSel)].map((b) => b.id) : [];
    const blocks = [...document.querySelectorAll("[data-dualtran-block]")]
      .filter((el) => !el.closest("[data-e2e-fixture-hidden]"));
    const bad = [];
    for (const el of blocks) {
      const ai = el.querySelector(aiSel);
      const google = el.querySelector(googleSel);
      const aiVisible = !!ai && isVisible(ai) && !!ai.textContent.trim();
      const googleVisible = !!google && isVisible(google) && !!google.textContent.trim();
      if (active[0] === "btnAi" && !aiVisible) bad.push("missing AI");
      if (googleVisible && !aiVisible) bad.push("visible Google-only block");
    }
    return { active, bad };
  }, { aiSel: AI_SELECTOR, googleSel: GOOGLE_SELECTOR, activeSel: FLOATING_ACTIVE });
  if (r.active[0] !== "btnAi") fail("assertNoStaleTranslation", `final active=${JSON.stringify(r.active)}`);
  else if (r.bad.length) fail("assertNoStaleTranslation", JSON.stringify(r.bad.slice(0, 4)));
  else pass("assertNoStaleTranslation");
}

/** E11: popup has no horizontal clipping; vertical page scroll is allowed. */
export async function assertPopupNoOverflow(page) {
  const r = await page.evaluate(() => {
    const isVisible = (el) => {
      if (!el) return false;
      let node = el;
      while (node && node.nodeType === 1) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        node = node.parentElement;
      }
      return true;
    };
    const roots = [document.body, ...document.querySelectorAll(".w3-container")].filter(isVisible);
    const bad = [];
    for (const el of roots) {
      if (el.scrollWidth > el.clientWidth + 1) {
        bad.push({ tag: el.tagName, id: el.id || "", scroll: el.scrollWidth, client: el.clientWidth });
      }
    }
    for (const el of document.querySelectorAll("*")) {
      if (el.children.length !== 0) continue;
      if (!(el.textContent || "").trim()) continue;
      if (!isVisible(el)) continue;
      if (el.scrollWidth > el.clientWidth + 1) {
        bad.push({ tag: el.tagName, text: el.textContent.trim().slice(0, 30), scroll: el.scrollWidth, client: el.clientWidth });
      }
    }
    return bad;
  });
  if (r.length) fail("assertPopupNoOverflow", JSON.stringify(r.slice(0, 3)));
  else pass("assertPopupNoOverflow");
}

/** E13: visible popup controls have real affordances; "Unknown" is allowed. */
export async function assertPopupControlsAffordances(page) {
  const r = await page.evaluate(() => {
    const isVisible = (el) => {
      if (!el) return false;
      let node = el;
      while (node && node.nodeType === 1) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        node = node.parentElement;
      }
      return true;
    };
    const bad = [];
    for (const el of document.querySelectorAll("input, select, button, label")) {
      if (!isVisible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) {
        bad.push(`${el.tagName.toLowerCase()}#${el.id || "?"}: zero-size`);
        continue;
      }
      if (el.tagName === "LABEL" || el.tagName === "BUTTON") {
        if (!(el.textContent || "").trim()) bad.push(`${el.tagName.toLowerCase()}#${el.id || "?"}: empty text`);
      }
      if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio")) {
        const label = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
        if (!label || !(label.textContent || "").trim()) {
          bad.push(`input#${el.id || "?"}: no label`);
        }
      }
    }
    return bad;
  });
  if (r.length) fail("assertPopupControlsAffordances", JSON.stringify(r.slice(0, 5)));
  else pass("assertPopupControlsAffordances");
}

/** E14: options sidebar has all six section entries. */
export async function assertOptionsSidebarEntries(page) {
  const r = await page.evaluate(() => {
    const isVisible = (el) => {
      if (!el) return false;
      let node = el;
      while (node && node.nodeType === 1) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        node = node.parentElement;
      }
      return true;
    };
    const nav = document.getElementById("sideBar");
    if (!nav || !isVisible(nav)) return { missing: true };
    const ids = ["languages", "sites", "ai", "style", "hotkeys", "feedback"];
    return {
      missing: false,
      items: ids.map((id) => {
        const a = nav.querySelector(`a[href="#${id}"]`);
        return { id, exists: !!a, visible: !!a && isVisible(a), text: (a?.textContent || "").trim() };
      }),
    };
  });
  if (r.missing) unknown("assertOptionsSidebarEntries", "sideBar missing/not visible");
  const bad = r.items.filter((x) => !x.exists || !x.visible || !x.text);
  if (bad.length) fail("assertOptionsSidebarEntries", JSON.stringify(bad));
  else pass("assertOptionsSidebarEntries", `${r.items.length} entries`);
}

/** E15a: no raw i18n key / placeholder leak in language selects. */
export async function assertLanguageSelectsNoLeak(page) {
  const r = await page.evaluate(() => {
    const isVisible = (el) => {
      if (!el) return false;
      let node = el;
      while (node && node.nodeType === 1) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        node = node.parentElement;
      }
      return true;
    };
    const ids = [
      "selectTargetLanguage",
      "selectTargetLanguageForText",
      "favoriteLanguage1",
      "favoriteLanguage2",
      "favoriteLanguage3",
    ];
    return ids.map((id) => {
      const el = document.getElementById(id);
      if (!el) return { id, missing: true };
      if (!isVisible(el)) return { id, hidden: true };
      const opts = [...el.options].map((o) => ({ value: o.value, text: (o.textContent || "").trim() }));
      const bad = opts.filter(
        (o) => !o.text || /^(lbl|btn|msg)[A-Z]/.test(o.text) || /^favoriteLanguage\d+$/.test(o.text)
      );
      return { id, count: opts.length, bad };
    });
  });
  const missing = r.filter((x) => x.missing);
  if (missing.length) unknown("assertLanguageSelectsNoLeak", JSON.stringify(missing));
  const target = r.filter((x) => x.id.startsWith("selectTargetLanguage"));
  const targetBad = target.filter((x) => !x.count || x.bad.length);
  const favoriteBad = r
    .filter((x) => x.id.startsWith("favoriteLanguage") && x.count > 0 && x.bad.length)
    .flatMap((x) => x.bad.map((b) => `${x.id}:${b.text}`));
  if (targetBad.length || favoriteBad.length) {
    fail("assertLanguageSelectsNoLeak", JSON.stringify([...targetBad, ...favoriteBad]));
  } else pass("assertLanguageSelectsNoLeak");
}

/** E15b: row alignment warning only. */
export async function assertLanguageRowsAlignedWarn(page) {
  const r = await page.evaluate(() => {
    const groups = [];
    const s1 = document.getElementById("selectTargetLanguage");
    const s2 = document.getElementById("selectTargetLanguageForText");
    if (s1 && s2) {
      const a = s1.getBoundingClientRect();
      const b = s2.getBoundingClientRect();
      groups.push({
        name: "target-select-column",
        diff: Math.max(Math.abs(a.left - b.left), Math.abs(a.width - b.width)),
      });
    }
    for (const row of document.querySelectorAll("li.w3-row")) {
      const label = row.querySelector("p");
      const select = row.querySelector("select");
      if (!label || !select) continue;
      const a = label.getBoundingClientRect();
      const b = select.getBoundingClientRect();
      const ac = a.top + a.height / 2;
      const bc = b.top + b.height / 2;
      groups.push({ name: row.id || "favorite-row", diff: Math.abs(ac - bc) });
    }
    return groups.filter((g) => g.diff > 10).map((g) => ({ name: g.name, diff: Number(g.diff.toFixed(1)) }));
  });
  if (r.length) fail("assertLanguageRowsAlignedWarn", JSON.stringify(r), "warn");
  else pass("assertLanguageRowsAlignedWarn");
}

/** E16: sidebar and content do not overlap. */
export async function assertNoSidebarOverlap(page) {
  const r = await page.evaluate(() => {
    const side = document.getElementById("sideBar");
    const main = document.querySelector(".w3-main");
    if (!side || !main) return { missing: true };
    const a = side.getBoundingClientRect();
    const b = main.getBoundingClientRect();
    return {
      overlapX: Math.min(a.right, b.right) - Math.max(a.left, b.left),
      overlapY: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
    };
  });
  if (r.missing) unknown("assertNoSidebarOverlap", "sideBar or .w3-main missing");
  if (r.overlapX > 1 && r.overlapY > 1) {
    fail("assertNoSidebarOverlap", `overlapX=${r.overlapX.toFixed(1)} overlapY=${r.overlapY.toFixed(1)}`);
  } else pass("assertNoSidebarOverlap");
}

/** E17/E20: every non-fixture block shows visible AI text. */
export async function assertAllBlocksShowAi(page, mode) {
  const r = await page.evaluate((aiSel) => {
    const isVisible = (el) => {
      if (!el) return false;
      let node = el;
      while (node && node.nodeType === 1) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        node = node.parentElement;
      }
      return true;
    };
    const all = [...document.querySelectorAll("[data-dualtran-block]")];
    const blocks = all.filter((el) => !el.closest("[data-e2e-fixture-hidden]"));
    const modes = [];
    let aiVisible = 0;
    for (const el of blocks) {
      const ai = el.querySelector(aiSel);
      const ok = isVisible(el) && !!ai && isVisible(ai) && !!ai.textContent.trim();
      if (ok) aiVisible++;
      modes.push(ok ? "ai" : isVisible(el) ? "other" : "hidden");
    }
    return { total: blocks.length, aiVisible, modes, excluded: all.length - blocks.length };
  }, AI_SELECTOR);
  if (r.total === 0) unknown("assertAllBlocksShowAi", "no visible blocks");
  if (r.aiVisible !== r.total) {
    fail("assertAllBlocksShowAi", `${mode}: ${r.aiVisible}/${r.total} blocks show AI (${JSON.stringify(r.modes)})`);
  } else pass("assertAllBlocksShowAi", `${mode}: ${r.aiVisible}/${r.total}`);
}

/** E18: no block is empty or clipped by an overflow:hidden ancestor. */
export async function assertNoEmptyOrClippedBlocks(page) {
  const r = await page.evaluate((aiSel) => {
    const isVisible = (el) => {
      if (!el) return false;
      let node = el;
      while (node && node.nodeType === 1) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        node = node.parentElement;
      }
      return true;
    };
    const blocks = [...document.querySelectorAll("[data-dualtran-block]")]
      .filter((el) => !el.closest("[data-e2e-fixture-hidden]"));
    const bad = [];
    for (const el of blocks) {
      const ai = el.querySelector(aiSel);
      const text = (ai?.textContent || "").trim();
      if (!isVisible(el) || !ai || !isVisible(ai) || !text) {
        bad.push("empty/hidden block");
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) bad.push("zero-size block");
      let node = el;
      while (node && node.nodeType === 1) {
        const s = getComputedStyle(node);
        if (s.overflow === "hidden" || s.overflowY === "hidden") {
          const ar = ai.getBoundingClientRect();
          if (ar.bottom > node.getBoundingClientRect().bottom + 2) bad.push("clipped by overflow:hidden");
          break;
        }
        node = node.parentElement;
      }
    }
    return bad;
  }, AI_SELECTOR);
  if (r.length) fail("assertNoEmptyOrClippedBlocks", JSON.stringify(r.slice(0, 4)));
  else pass("assertNoEmptyOrClippedBlocks");
}

/** E19: floating group only-AI active, hover group dismissed. */
export async function assertFloatingOnlyAndHoverDismissed(page) {
  const r = await page.evaluate((sel) => {
    const isVisible = (el) => {
      if (!el) return false;
      let node = el;
      while (node && node.nodeType === 1) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        node = node.parentElement;
      }
      return true;
    };
    const floating = document.getElementById("dualtran-floating-btn-host");
    const active = floating?.shadowRoot ? [...floating.shadowRoot.querySelectorAll(sel)].map((b) => b.id) : [];
    const singleton = document.getElementById("dualtran-singleton-btn-host");
    const top = singleton ? parseFloat(getComputedStyle(singleton).top) : 0;
    return {
      active,
      singletonTop: top,
      // top:-9999px is the product's offscreen hide; it is not "visible".
      hoverVisible: !!singleton && isVisible(singleton) && top > -9000,
    };
  }, FLOATING_ACTIVE);
  if (r.active.length !== 1 || r.active[0] !== "btnAi") {
    fail("assertFloatingOnlyAndHoverDismissed", `floating active=${JSON.stringify(r.active)}`);
    return;
  }
  if (r.hoverVisible) {
    fail("assertFloatingOnlyAndHoverDismissed", `hover group still visible (top=${r.singletonTop})`);
    return;
  }
  pass("assertFloatingOnlyAndHoverDismissed");
}

/** E21: replaceOriginal shows AI text, not a raw source-only block. */
export async function assertNoRawSourceInReplaceMode(page, aiSentinels = ["[aimock]"]) {
  const r = await page.evaluate(({ sentinels }) => {
    const blocks = [...document.querySelectorAll("[data-dualtran-block]")]
      .filter((el) => !el.closest("[data-e2e-fixture-hidden]"));
    const bad = [];
    for (const el of blocks) {
      const text = (el.innerText || "").trim();
      if (!sentinels.some((s) => text.includes(s))) bad.push(text.slice(0, 50));
    }
    return bad;
  }, { sentinels: aiSentinels });
  if (r.length) fail("assertNoRawSourceInReplaceMode", JSON.stringify(r.slice(0, 3)));
  else pass("assertNoRawSourceInReplaceMode");
}

/** E22: no clipped/overlapping block contents after the round trip. */
export async function assertNoBlockClipOrOverlap(page) {
  const r = await page.evaluate((aiSel) => {
    const all = [...document.querySelectorAll("[data-dualtran-block]")]
      .filter((el) => !el.closest("[data-e2e-fixture-hidden]"));
    // Nested blocks legitimately overlap their parent; compare top-level blocks only.
    const blocks = all.filter((el) => !el.parentElement?.closest("[data-dualtran-block]"));
    const bad = [];
    const rects = [];
    for (const el of blocks) {
      const ai = el.querySelector(aiSel);
      if (!ai) continue;
      const br = el.getBoundingClientRect();
      const ar = ai.getBoundingClientRect();
      if (ar.left < br.left - 2 || ar.right > br.right + 2 || ar.top < br.top - 2 || ar.bottom > br.bottom + 2) {
        bad.push("AI text outside block");
      }
      rects.push({ br, ar });
    }
    for (let i = 1; i < rects.length; i++) {
      const a = rects[i - 1].ar;
      const b = rects[i].ar;
      const vOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const hOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      if (vOverlap > 2 && hOverlap > 2) bad.push("adjacent AI spans overlap");
    }
    return bad;
  }, AI_SELECTOR);
  if (r.length) fail("assertNoBlockClipOrOverlap", JSON.stringify(r.slice(0, 4)));
  else pass("assertNoBlockClipOrOverlap");
}

/** E23: collapsed preview has translated (French) text below the source line. */
export async function assertCollapsedPreviewTranslated(page) {
  const r = await page.evaluate(() => {
    const isVisible = (el) => {
      if (!el) return false;
      let node = el;
      while (node && node.nodeType === 1) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        node = node.parentElement;
      }
      return true;
    };
    const container = document.getElementById("showmore-container");
    const source = document.getElementById("showmore-visible");
    const google = container?.querySelector(".dualtran-google");
    if (!container || !source || !google) return { missing: true };
    const src = (source.textContent || "").trim();
    const gt = (google.textContent || "").trim();
    const gr = google.getBoundingClientRect();
    const sr = source.getBoundingClientRect();
    return {
      missing: false,
      visible: isVisible(google),
      translated: gt.length > 0 && gt !== src,
      below: gr.top >= sr.bottom - 2,
      source: src.slice(0, 40),
      translatedText: gt.slice(0, 40),
    };
  });
  if (r.missing) unknown("assertCollapsedPreviewTranslated", "showmore container/source/google missing");
  if (!r.visible || !r.translated || !r.below) {
    fail("assertCollapsedPreviewTranslated", JSON.stringify(r));
  } else pass("assertCollapsedPreviewTranslated");
}

/** E24: show-more button still in collapsed label state. */
export async function assertShowMoreCollapsed(page) {
  const r = await page.evaluate(() => {
    const btn = document.getElementById("showmore-btn");
    return { missing: !btn, text: (btn?.textContent || "").trim() };
  });
  if (r.missing) unknown("assertShowMoreCollapsed", "#showmore-btn missing");
  // Google may append its translation inline (e.g. "Show moreAfficher plus");
  // judge the source label, not exact equality.
  const text = r.text.toLowerCase();
  if (!text.startsWith("show more") || text.includes("show less")) {
    fail("assertShowMoreCollapsed", `text=${JSON.stringify(r.text)}`);
  } else pass("assertShowMoreCollapsed");
}

/** E25: no expanded long paragraph is visible before the update channels run. */
export async function assertBeforeExpandCollapsed(page) {
  const r = await page.evaluate(() => {
    const hidden = document.getElementById("showmore-hidden");
    if (!hidden) return { absent: true };
    const rect = hidden.getBoundingClientRect();
    const style = getComputedStyle(hidden);
    return { absent: false, display: style.display, height: rect.height };
  });
  if (r.absent) return pass("assertBeforeExpandCollapsed", "hidden paragraph not in DOM yet");
  if (r.display === "none" || r.height === 0) return pass("assertBeforeExpandCollapsed");
  fail("assertBeforeExpandCollapsed", JSON.stringify(r));
}
