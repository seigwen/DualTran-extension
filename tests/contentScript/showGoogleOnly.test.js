/**
 * Tests for showGoogleOnly() and re-translate AI behavior.
 *
 * Bug 1 (replaceOriginal mode): showGoogleOnly() only toggles googleSpan/aiSpan
 * display, but replaceOriginal mode blocks have NO googleSpan/aiSpan (registerBlock
 * is called without span options). So showGoogleOnly() does nothing.
 *
 * Bug 2 (newLine mode): showGoogleOnly() hides aiSpan but does NOT reset aiStatus
 * on blocks. When user clicks AI again, getProxiesForTranslation() filters out all
 * blocks with aiStatus="translated", so aiTranslateDynamically() has nothing to do.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  registerBlock,
  getProxiesForTranslation,
  getAllProxies,
  getBlockState,
} from "../../src/contentScript/singletonBtnGroup.js";
import { applyShowGoogleOnlyState } from "../../src/contentScript/aiUiState.js";

/**
 * Create translated blocks in newLine mode using the GLOBAL document.
 * Each block has googleSpan + aiSpan (dual-span structure).
 */
function createNewLineModeBlocks() {
  const container = document.createElement("div");
  container.id = "test-newline-container";
  document.body.appendChild(container);

  const blocks = [];
  for (let i = 1; i <= 3; i++) {
    const p = document.createElement("p");
    p.id = `nl-p${i}`;
    p.textContent = `Original text ${i}`;
    container.appendChild(p);

    const translatedEl = document.createElement("translated");
    translatedEl.style.display = "block";

    const googleSpan = document.createElement("span");
    googleSpan.className = "dualtran-google";
    googleSpan.textContent = `Google translation ${i}`;

    const aiSpan = document.createElement("span");
    aiSpan.className = "dualtran-ai";
    aiSpan.style.display = "none";

    translatedEl.appendChild(googleSpan);
    translatedEl.appendChild(aiSpan);
    p.appendChild(translatedEl);

    registerBlock(
      translatedEl,
      `Original text ${i}`,
      googleSpan,
      `Google translation ${i}`,
      null,
      { googleSpan, aiSpan }
    );

    blocks.push({ translatedEl, googleSpan, aiSpan, p });
  }

  return { container, blocks };
}

/**
 * Create translated blocks in replaceOriginal mode using the GLOBAL document.
 * Blocks have NO googleSpan/aiSpan.
 */
function createReplaceOriginalModeBlocks() {
  const container = document.createElement("div");
  container.id = "test-replace-container";
  document.body.appendChild(container);

  const blocks = [];
  for (let i = 1; i <= 3; i++) {
    const p = document.createElement("p");
    p.id = `ro-p${i}`;
    p.textContent = `Google translation ${i}`;
    container.appendChild(p);

    const translatedTextNode = document.createElement("span");
    translatedTextNode.className = "dualtran-aitranslatedtext-replacemode";
    translatedTextNode.textContent = `Google translation ${i}`;
    p.appendChild(translatedTextNode);

    const textNode = document.createTextNode(`Original text ${i}`);

    registerBlock(
      p,
      `Original text ${i}`,
      translatedTextNode,
      `Google translation ${i}`,
      [textNode]
    );

    blocks.push({ translatedEl: p, translatedTextNode, textNode });
  }

  return { container, blocks };
}

function cleanup(container) {
  if (container && container.parentNode) {
    container.parentNode.removeChild(container);
  }
}

/**
 * Call the REAL per-block showGoogleOnly logic (applyShowGoogleOnlyState)
 * for every registered block — the same code path pageTranslator.showGoogleOnly
 * uses, so these tests exercise production logic, not a simulated copy.
 */
function simulateShowGoogleOnly() {
  getAllProxies().forEach((p) => {
    applyShowGoogleOnlyState(p, []);
  });
}

describe("showGoogleOnly — Bug 1: replaceOriginal mode", () => {
  afterEach(() => {
    document.querySelectorAll("#test-newline-container, #test-replace-container")
      .forEach(el => el.remove());
  });

  it("newLine mode: showGoogleOnly should show googleSpan and hide aiSpan", () => {
    const { container, blocks } = createNewLineModeBlocks();

    // Simulate AI translation done: show aiSpan, hide googleSpan
    blocks.forEach(({ googleSpan, aiSpan }) => {
      googleSpan.style.display = "none";
      aiSpan.style.display = "block";
      aiSpan.textContent = "AI translation";
    });

    // Act: simulate showGoogleOnly
    simulateShowGoogleOnly();

    // Assert: Google visible, AI hidden
    blocks.forEach(({ googleSpan, aiSpan }, idx) => {
      expect(googleSpan.style.display).toBe("block",
        `Block ${idx}: googleSpan should be visible`);
      expect(aiSpan.style.display).toBe("none",
        `Block ${idx}: aiSpan should be hidden`);
    });

    cleanup(container);
  });

  it("BUG 1: replaceOriginal mode — proxy should expose nodesToClear for showGoogleOnly", () => {
    const { container, blocks } = createReplaceOriginalModeBlocks();

    // Simulate AI translation done: translatedTextNode has AI text
    blocks.forEach(({ translatedTextNode }) => {
      translatedTextNode.textContent = "AI translation";
    });

    // Verify AI text is showing
    expect(blocks[0].translatedTextNode.textContent).toBe("AI translation");

    // Key assertion: proxy must expose nodesToClear so showGoogleOnly can restore original text
    const proxies = getAllProxies();
    expect(proxies.length).toBeGreaterThan(0);

    proxies.forEach((p, idx) => {
      // BUG 1 ROOT CAUSE: before fix, nodesToClear was undefined on proxy
      expect(p.nodesToClear).toBeDefined();
      expect(p.googleTranslatedText).toBeDefined();
    });

    // Act: simulate showGoogleOnly
    simulateShowGoogleOnly();

    // After fix: aiStatus reset and translationId cleared
    proxies.forEach((p, idx) => {
      expect(p.translationStatus).toBe("idle",
        `Block ${idx}: aiStatus should be reset to "idle" after showGoogleOnly`);
      expect(p.translationId).toBe("",
        `Block ${idx}: translationId should be cleared after showGoogleOnly`);
    });

    cleanup(container);
  });
});

describe("showGoogleOnly — Bug 2: re-translate AI after showGoogleOnly", () => {
  afterEach(() => {
    document.querySelectorAll("#test-newline-container, #test-replace-container")
      .forEach(el => el.remove());
  });

  it("BUG 2: after showGoogleOnly, blocks should be available for re-translation", () => {
    const { container, blocks } = createNewLineModeBlocks();

    // Simulate AI translation done: set aiStatus to "translated"
    blocks.forEach(({ translatedEl, aiSpan }) => {
      aiSpan.style.display = "block";
      aiSpan.textContent = "AI translation";
      const state = getBlockState(translatedEl);
      state.aiStatus = "translated";
    });

    // Act: simulate showGoogleOnly
    simulateShowGoogleOnly();

    // BUG 2 DETECTION: getProxiesForTranslation() filters out "translated" blocks.
    // showGoogleOnly() does NOT reset aiStatus, so 0 blocks are returned.
    const blocksNeedingAi = getProxiesForTranslation();

    expect(blocksNeedingAi.length).toBeGreaterThan(0,
      "After showGoogleOnly, blocks should be available for AI re-translation. " +
      `Got ${blocksNeedingAi.length} blocks — aiStatus was not reset. This is Bug 2.`);

    cleanup(container);
  });

  it("after showGoogleOnly, aiStatus should be reset to idle", () => {
    const { container, blocks } = createNewLineModeBlocks();

    // Simulate AI translation done
    blocks.forEach(({ translatedEl }) => {
      const state = getBlockState(translatedEl);
      state.aiStatus = "translated";
    });

    // Act: simulate showGoogleOnly
    simulateShowGoogleOnly();

    // Assert: aiStatus should be reset to "idle"
    blocks.forEach(({ translatedEl }, idx) => {
      const state = getBlockState(translatedEl);
      expect(state.aiStatus).toBe("idle",
        `Block ${idx}: aiStatus should be "idle" after showGoogleOnly`);
    });

    cleanup(container);
  });

  it("after showGoogleOnly, translationId should be cleared", () => {
    const { container, blocks } = createNewLineModeBlocks();

    // Simulate AI translation done with translationId
    blocks.forEach(({ translatedEl }) => {
      const state = getBlockState(translatedEl);
      state.aiStatus = "translated";
      state.translationId = "i12345678";
    });

    // Act: simulate showGoogleOnly
    simulateShowGoogleOnly();

    // Assert: translationId should be cleared
    blocks.forEach(({ translatedEl }, idx) => {
      const state = getBlockState(translatedEl);
      expect(state.translationId).toBe("",
        `Block ${idx}: translationId should be cleared after showGoogleOnly`);
    });

    cleanup(container);
  });
});

describe("behavior 4 full flow: AI → Google+AI → Google only → AI again", () => {
  afterEach(() => {
    document.querySelectorAll("#test-newline-container, #test-replace-container")
      .forEach(el => el.remove());
  });

  it("newLine mode: full behavior 4 cycle allows re-translating with AI", () => {
    const { container, blocks } = createNewLineModeBlocks();

    // Step 1: AI button clicked → Google+AI concurrent → AI done
    blocks.forEach(({ googleSpan, aiSpan, translatedEl }) => {
      googleSpan.style.display = "none";
      aiSpan.style.display = "block";
      aiSpan.textContent = "AI translation";
      const state = getBlockState(translatedEl);
      state.aiStatus = "translated";
    });

    // Step 2: Google button clicked → show Google only
    simulateShowGoogleOnly();

    // Verify: Google visible, AI hidden
    blocks.forEach(({ googleSpan, aiSpan }) => {
      expect(googleSpan.style.display).toBe("block");
      expect(aiSpan.style.display).toBe("none");
    });

    // Step 3: AI button clicked again → should re-translate
    const blocksNeedingAi = getProxiesForTranslation();
    expect(blocksNeedingAi.length).toBe(blocks.length,
      "After behavior 4, all blocks should be available for AI re-translation");

    cleanup(container);
  });

  it("replaceOriginal mode: showGoogleOnly keeps Google text, not original text", () => {
    const { container, blocks } = createReplaceOriginalModeBlocks();

    // Simulate Google+AI concurrent done:
    // - text nodes were originally "Original text N"
    // - Google translation replaced them with "Google translation N"
    // - AI translation wrote to translatedTextNode, then applyAiTranslatingState
    //   cleared text nodes and hid parents
    blocks.forEach(({ translatedEl, translatedTextNode, textNode }) => {
      // Google translation replaced the text node content
      textNode.textContent = "Google translation";
      // AI translation wrote to translatedTextNode
      translatedTextNode.textContent = "AI translation";
      // Simulate AI hiding parent (as applyAiTranslatingState does)
      const state = getBlockState(translatedEl);
      state.aiStatus = "translated";
    });

    // Act: showGoogleOnly
    simulateShowGoogleOnly();

    // CRITICAL: text nodes should still have Google translation, NOT original text
    blocks.forEach(({ textNode, translatedTextNode }, idx) => {
      expect(textNode.textContent).toBe("Google translation",
        `Block ${idx}: text node should keep Google translation, not revert to original`);
      expect(translatedTextNode.textContent).toBe("",
        `Block ${idx}: AI translatedTextNode should be cleared`);
    });

    cleanup(container);
  });
});
