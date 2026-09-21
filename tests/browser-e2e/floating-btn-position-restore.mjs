/**
 * DualTran E2E — 悬浮按钮组「已保存位置 + 视口回收」回归（issue #78 + #80）
 *
 * 用户报告症状（#78）：部分网站载入后右侧悬浮按钮组完全不显示；拖动窗口
 * （触发 resize）后恢复。
 *
 * 根因 #78（回归于 #19 三态重构）：restore 路径调用 applyFloatingBtnWidth()
 * → updateButtons() 读取了尚未初始化的 BUTTON_STYLES → 异常被 restore 的
 * try/catch 吞掉 → 紧随其后的 clampContainerToViewport() 永不执行 →
 * 已保存的屏外位置被原样应用。生产构建 drop_console，控制台无任何日志。
 *
 * 根因 #80（历史缺陷，v2.1.30 已存在）：被定位元素是 layer（容器 + 38px
 * 快捷键条），但钳制与拖拽的高度预算都只算容器高 → 面板底边（AI 按钮行）
 * 可被放到视口外最多 38px。修复后两处预算统一为 getLayerBoxSize()。
 *
 * 断言策略（症状级，不绑定实现细节）：
 *   - 屏外 seed（5000,5000）：载入后左缘钳制贴右缘，**且面板完整可见**
 *     （bottom ≤ innerHeight，容差 1px；修复前溢出 38px = vis 73%）。
 *   - 窄窗口 seed（保存自更宽窗口的 1188,300 @1100 视口）：载入后左缘必须
 *     被钳制进视口（= innerWidth - 面板宽），top 保持 seed 值；且钳制后
 *     2.5s 内不回弹。
 *   - 无 seed 对照（负向，防假阳性）：默认锚定位置必须完整可见——不能因为
 *     钳制逻辑过度激进而把默认位置也改写。
 *   - 真实指针拖拽到底边（#80）：layer 盒底必须贴视口底（容差 1px）且面板
 *     完整可见——用 page.mouse 驱动真实拖拽（非合成事件），并断言持久化的
 *     坐标就是钳制后的值。
 */

import {
  readStorage,
  waitForContentScriptInjected,
  waitForPageTranslatorReady,
  writeStorage,
} from "./setup.mjs";

export const name = "floating-btn-position-restore";
export const needsMock = false;
export const smoke = false;

const HOST_ID = "dualtran-floating-btn-host";
const POSITION_KEY = "floatingBtnPosition";
const WIDTH_KEY = "floatingBtnWidth";

function fail(label, message) {
  throw new Error(`[floating-pos] ${label}: ${message}`);
}

/** 清掉已保存的位置/宽度，避免场景间污染（本场景结束后必须回到默认态）。 */
async function clearSavedPosition(serviceWorker) {
  await serviceWorker.evaluate(
    async ({ posKey, wKey }) => {
      await chrome.storage.local.remove([posKey, wKey]);
    },
    { posKey: POSITION_KEY, wKey: WIDTH_KEY }
  );
}

/**
 * 读取面板（#floatingBtnContainer）与层（#floatingBtnLayer）几何 + 视口交集。
 * 修复前信号：invisible=true / visiblePct=0。
 *
 * 注：层的 top 坐标是「已保存坐标」的载体；面板 rect 因 #floatingBtnBody 的
 * 38px padding-top 而整体下移 38px（层坐标系 ≠ 面板坐标系）。
 */
async function probePanel(page) {
  return page.evaluate((hostId) => {
    const host = document.getElementById(hostId);
    const root = host?.shadowRoot || null;
    const container = root?.getElementById("floatingBtnContainer");
    if (!container) return { hostFound: !!host, containerFound: false };
    const layer = root?.getElementById("floatingBtnLayer");
    const r = container.getBoundingClientRect();
    const l = layer?.getBoundingClientRect();
    const visW = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const visH = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    const area = r.width * r.height || 1;
    return {
      hostFound: true,
      containerFound: true,
      inner: [innerWidth, innerHeight],
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      layerRect: l ? [Math.round(l.left), Math.round(l.top), Math.round(l.width), Math.round(l.height)] : null,
      layerInlineLeft: layer?.style?.left ?? null,
      layerInlineTop: layer?.style?.top ?? null,
      visiblePct: Math.round(((visW * visH) / area) * 100),
      invisible: visW * visH === 0,
      fullyVisible: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
    };
  }, HOST_ID);
}

/**
 * 载入协议（leak-free）：about:blank → 设视口 → 清 seed → 写 seed → 导航。
 * 先跳 about:blank 保证上一页的 resize handler 不会在设视口时写回 storage。
 */
async function loadWithSeededPosition(page, serviceWorker, url, { viewport, position }) {
  await page.goto("about:blank").catch(() => {});
  if (viewport) {
    await page.setViewportSize(viewport);
  }
  await clearSavedPosition(serviceWorker);
  if (position) {
    await writeStorage(serviceWorker, POSITION_KEY, position);
    await writeStorage(serviceWorker, WIDTH_KEY, 92);
  }
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForContentScriptInjected(serviceWorker, page.url());
  await waitForPageTranslatorReady(serviceWorker, page.url());
  await page.waitForFunction(
    (hostId) => {
      const host = document.getElementById(hostId);
      return !!(host && host.shadowRoot && host.shadowRoot.getElementById("floatingBtnContainer"));
    },
    HOST_ID,
    { timeout: 15000 }
  );
  // 给 restore 块（同步执行）+ 可能的异步重建留出稳定窗口
  await page.waitForTimeout(400);
}

/** 断言「实质可见」：交集面积 ≥50%（修复前 0%，修复后 ~73%+，阈值居中留余量）。 */
function assertSubstantiallyVisible(p, label) {
  if (!p.containerFound) {
    fail(label, `floating panel not found in DOM (hostFound=${p.hostFound})`);
  }
  if (p.invisible) {
    fail(
      label,
      `panel INVISIBLE at load (user symptom): rect=${JSON.stringify(p.rect)} vp=${JSON.stringify(p.inner)}`
    );
  }
  if (p.visiblePct < 50) {
    fail(
      label,
      `panel only ${p.visiblePct}% visible (<50%): rect=${JSON.stringify(p.rect)} vp=${JSON.stringify(p.inner)}`
    );
  }
}

async function runCellSavedOffscreen(page, serviceWorker, testPageUrl) {
  console.log("  Cell 1: saved off-screen position (5000,5000) @1280x720");
  await loadWithSeededPosition(page, serviceWorker, testPageUrl, {
    viewport: { width: 1280, height: 720 },
    position: { left: 5000, top: 5000 },
  });

  const atLoad = await probePanel(page);
  assertSubstantiallyVisible(atLoad, "extreme-offscreen");
  const [x, y, w] = atLoad.rect;
  const [vw, vh] = atLoad.inner;
  const expectedLeft = vw - w; // clamp 上限：贴视口右缘
  if (Math.abs(x - expectedLeft) > 1) {
    fail("extreme-offscreen", `left=${x} not clamped to right edge (expected ${expectedLeft})`);
  }
  if (x < 0 || x + w > vw + 1) {
    fail("extreme-offscreen", `horizontally outside viewport: rect=${JSON.stringify(atLoad.rect)}`);
  }
  if (y < 0 || y >= vh) {
    fail("extreme-offscreen", `top=${y} outside viewport height ${vh}`);
  }
  // #80: the clamp must budget the LAYER box (panel + 38px strip), so the
  // panel is FULLY visible — not just 73% with the bottom row cut off.
  if (!atLoad.fullyVisible) {
    fail(
      "extreme-offscreen",
      `panel not fully visible after clamp (#80 regression): rect=${JSON.stringify(atLoad.rect)} vp=${JSON.stringify(atLoad.inner)}`
    );
  }
  console.log(`     atLoad rect=${JSON.stringify(atLoad.rect)} vis=${atLoad.visiblePct}% ✓`);

  // 稳定性：钳制结果不得在数秒内回弹（防止「先钳后弹回屏外」的假修复）
  await page.waitForTimeout(2500);
  const afterSettle = await probePanel(page);
  assertSubstantiallyVisible(afterSettle, "extreme-offscreen(+2.5s)");
  if (Math.abs(afterSettle.rect[0] - x) > 1 || Math.abs(afterSettle.rect[1] - y) > 1) {
    fail(
      "extreme-offscreen(+2.5s)",
      `position drifted after settle: ${JSON.stringify(atLoad.rect)} -> ${JSON.stringify(afterSettle.rect)}`
    );
  }
  console.log(`     +2.5s stable rect=${JSON.stringify(afterSettle.rect)} ✓`);
}

async function runCellNarrowWindow(page, serviceWorker, testPageUrl) {
  console.log("  Cell 2: saved on a wider window (1188,300) @1100x720");
  await loadWithSeededPosition(page, serviceWorker, testPageUrl, {
    viewport: { width: 1100, height: 720 },
    position: { left: 1188, top: 300 },
  });

  const atLoad = await probePanel(page);
  assertSubstantiallyVisible(atLoad, "narrow-window");
  const [x, , w] = atLoad.rect;
  const [vw] = atLoad.inner;
  const expectedLeft = vw - w;
  if (Math.abs(x - expectedLeft) > 1) {
    fail("narrow-window", `left=${x} not clamped into viewport (expected ${expectedLeft})`);
  }
  // top 在界内 → 层坐标必须保持 seed 原值 300（证明 restore 生效，而非被默认位置覆盖）。
  // 注意：面板 rect 因 38px 快捷键条 padding 为 338，故断言层坐标（layer*）。
  const layerTop = atLoad.layerRect ? atLoad.layerRect[1] : null;
  if (layerTop === null || Math.abs(layerTop - 300) > 1) {
    fail("narrow-window", `layer top=${layerTop} should keep the saved 300 (restore must apply)`);
  }
  console.log(`     atLoad rect=${JSON.stringify(atLoad.rect)} layerTop=${layerTop} vis=${atLoad.visiblePct}% ✓`);
}

async function runCellCleanControl(page, serviceWorker, testPageUrl) {
  console.log("  Cell 3: no saved position (negative control) @1280x720");
  await loadWithSeededPosition(page, serviceWorker, testPageUrl, {
    viewport: { width: 1280, height: 720 },
    position: null,
  });

  const atLoad = await probePanel(page);
  if (!atLoad.containerFound) {
    fail("clean-control", `floating panel not found in DOM (hostFound=${atLoad.hostFound})`);
  }
  if (!atLoad.fullyVisible) {
    fail(
      "clean-control",
      `default placement must stay fully visible (no false clamp): rect=${JSON.stringify(atLoad.rect)} vp=${JSON.stringify(atLoad.inner)}`
    );
  }
  console.log(`     default placement fully visible rect=${JSON.stringify(atLoad.rect)} ✓`);
}

/**
 * Cell 4（#80）：真实指针拖拽到底边——layer 盒（面板 + 38px 条）必须贴住
 * 而非越过视口底，且持久化的坐标就是钳制后的值。用 page.mouse 驱动真实
 * 拖拽（非合成事件），走的是 onPointerMove 的拖拽钳制路径。
 */
async function runCellDragToBottomEdge(page, serviceWorker, testPageUrl) {
  console.log("  Cell 4: real-pointer drag to the bottom edge (#80) @1280x720");
  await loadWithSeededPosition(page, serviceWorker, testPageUrl, {
    viewport: { width: 1280, height: 720 },
    position: null,
  });

  // 取拖拽把手的屏幕坐标（在 shadow root 内）。
  const handleBox = await page.evaluate((hostId) => {
    const host = document.getElementById(hostId);
    const handle = host?.shadowRoot?.getElementById("dragHandle");
    if (!handle) return null;
    const r = handle.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, HOST_ID);
  if (!handleBox) {
    fail("drag-bottom-edge", "drag handle not found in shadow root");
  }

  // 真实指针拖拽：远超底边（+500px），拖拽钳制必须兜住。
  await page.mouse.move(handleBox.x, handleBox.y);
  await page.mouse.down();
  await page.mouse.move(handleBox.x, handleBox.y + 500, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300); // savePosition（同步）后的稳定窗口

  const after = await probePanel(page);
  if (!after.containerFound || !after.layerRect) {
    fail("drag-bottom-edge", "panel/layer lost after drag");
  }
  const [, layerTop, , layerH] = after.layerRect;
  const [, vh] = after.inner;
  const layerBottom = layerTop + layerH;

  // #80 核心断言：layer 盒底贴住视口底，不得越过（修复前溢出 38px）。
  if (layerBottom > vh + 1) {
    fail(
      "drag-bottom-edge",
      `layer box overflows viewport bottom by ${layerBottom - vh}px (AI row cut off): ${JSON.stringify(after.layerRect)} vp=${JSON.stringify(after.inner)}`
    );
  }
  if (layerBottom < vh - 1) {
    fail("drag-bottom-edge", `layer not pinned to bottom edge: bottom=${layerBottom} vh=${vh}`);
  }
  if (!after.fullyVisible) {
    fail(
      "drag-bottom-edge",
      `panel not fully visible after drag: rect=${JSON.stringify(after.rect)} vp=${JSON.stringify(after.inner)}`
    );
  }

  // 持久化坐标 = 钳制后坐标（证明 savePosition 存的就是被钳的值）。
  const saved = await readStorage(serviceWorker, POSITION_KEY);
  const appliedTop = Math.round(parseFloat(after.layerInlineTop || "0"));
  if (!saved || typeof saved.top !== "number" || Math.abs(saved.top - appliedTop) > 1) {
    fail(
      "drag-bottom-edge",
      `persisted top=${saved && saved.top} != applied top=${appliedTop}`
    );
  }
  console.log(
    `     layerBottom=${layerBottom} vh=${vh} savedTop=${saved.top} fullyVisible ✓`
  );
}

export async function run(scope) {
  const { page, serviceWorker, testPageUrl, collector } = scope;

  console.log("\n════════════════════════════════════════════");
  console.log("  Floating Button Position Restore E2E (#78)");
  console.log("════════════════════════════════════════════\n");

  await collector?.attachPage?.(page, "floating-btn-position-restore");

  // 悬浮按钮必须显式开启（默认 yes，但前序场景可能改为 no 且 resetScenarioState
  // 刻意不复位 showFloatingBtn——本场景不显式写就可能在残留 no 上空跑）
  await writeStorage(serviceWorker, "showFloatingBtn", "yes");

  try {
    await runCellSavedOffscreen(page, serviceWorker, testPageUrl);
    await runCellNarrowWindow(page, serviceWorker, testPageUrl);
    await runCellCleanControl(page, serviceWorker, testPageUrl);
    await runCellDragToBottomEdge(page, serviceWorker, testPageUrl);
    console.log("\n  PASS: position restore + viewport clamp regression covered (#78, #80)\n");
  } catch (err) {
    collector?.record?.("floating-btn-position-restore", err.message);
    console.error(`\n  FLOATING POSITION RESTORE FAILED: ${err.message}\n`);
    throw err;
  } finally {
    // 场景间零污染：清掉本场景写入的存储键 + 复位视口
    await clearSavedPosition(serviceWorker).catch(() => {});
    await page
      .setViewportSize({ width: 1280, height: 720 })
      .catch(() => {});
  }
}
