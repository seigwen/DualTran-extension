/**
 * Tests for aiUiState.js nodesToClear behavior.
 *
 * Bug scenario: When AI translation succeeds in replaceOriginal mode,
 * applyAiSuccessState() hides ALL parent elements of cleared text nodes,
 * including block-level elements like <li>, <p>, <ul>. This causes entire
 * subsections (e.g., "Global Providers" list) to disappear from the page.
 *
 * Expected: Only inline wrapper elements (<code>, <a>, <span>, <b>) should
 * be hidden. Block-level elements containing the text should remain visible
 * (with their text content cleared).
 */

import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import {
  applyAiSuccessState,
} from "../../src/contentScript/aiUiState.js";

/**
 * Create a mock btnAi object with proper classList support.
 */
function createMockBtnAi(state) {
  const classes = new Set();
  const dom = new JSDOM("");
  const doc = dom.window.document;
  return {
    _st: () => state,
    aiSpan: state.aiSpan,
    googleSpan: state.googleSpan,
    translatedTextNode: state.googleSpan,
    translationStatus: state.aiStatus || "translating",
    btnAiTxtNode: doc.createElement("span"),
    tooltip: doc.createElement("span"),
    style: {},
    classList: {
      remove: (...args) => args.forEach(c => classes.delete(c)),
      add: (...args) => args.forEach(c => classes.add(c)),
      contains: (c) => classes.has(c),
    },
    ownerDocument: doc,
    getAttribute: () => null,
    setAttribute: vi.fn(),
    _classes: classes,
  };
}

/**
 * Build a simulated "Third-party Services & Transfers" section
 * with nested h4 + ul > li structure to reproduce the disappearing subsection bug.
 */
function createPrivacyPolicySection() {
  const html = `
    <section id="third-parties">
      <h2>Third-party Services &amp; Transfers</h2>
      <h3>AI Providers</h3>
      <h4>Global Providers</h4>
      <ul>
        <li>OpenAI (<span class="mono">api.openai.com</span>): <a href="https://openai.com/privacy">Privacy Policy</a></li>
        <li>Anthropic (<span class="mono">api.anthropic.com</span>): <a href="https://anthropic.com/privacy">Privacy Policy</a></li>
        <li>Google Gemini (<span class="mono">generativelanguage.googleapis.com</span>): <a href="https://policies.google.com/privacy">Privacy Policy</a></li>
      </ul>
      <h4>China-based Providers</h4>
      <ul>
        <li>DeepSeek (<span class="mono">api.deepseek.com</span>): <a href="https://deepseek.com/privacy">Privacy Policy</a></li>
      </ul>
    </section>
  `;
  const dom = new JSDOM(html);
  return dom.window.document;
}

/**
 * Simulate what registerBlock() does: collect text nodes from <li> elements
 * as nodesToClear, and create googleSpan + aiSpan.
 */
function simulateRegisterBlockForList(document) {
  const lis = document.querySelectorAll("#third-parties ul li");
  const nodesToClear = [];

  lis.forEach((li) => {
    // Collect direct child text nodes (same as what the translation engine does)
    for (const child of li.childNodes) {
      if (child.nodeType === 3 && child.textContent.trim()) {
        nodesToClear.push(child);
      }
    }
  });

  // Create googleSpan and aiSpan (simulating the dual-span structure)
  const section = document.querySelector("#third-parties");
  const translatedEl = document.createElement("translated");
  translatedEl.style.display = "block";
  const googleSpan = document.createElement("span");
  googleSpan.className = "dualtran-google";
  googleSpan.textContent = "translated text";
  const aiSpan = document.createElement("span");
  aiSpan.className = "dualtran-ai";
  aiSpan.style.display = "none";
  translatedEl.appendChild(googleSpan);
  translatedEl.appendChild(aiSpan);
  section.appendChild(translatedEl);

  return { nodesToClear, googleSpan, aiSpan, translatedEl };
}

describe("aiUiState — nodesToClear must not hide block-level parents", () => {
  it("should NOT hide <li> parent when clearing a text node inside it", () => {
    const document = createPrivacyPolicySection();
    const { nodesToClear, googleSpan, aiSpan } = simulateRegisterBlockForList(document);

    const btnAi = createMockBtnAi({ nodesToClear, googleSpan, aiSpan, aiStatus: "translating" });
    applyAiSuccessState(btnAi, { translatedText: "AI translation result" });

    // The <li> elements must NOT be hidden — they are block-level elements
    const lis = document.querySelectorAll("#third-parties ul li");
    lis.forEach((li, idx) => {
      expect(li.style.display).not.toBe("none",
        `<li> at index ${idx} should NOT be hidden by display:none`);
    });
  });

  it("should NOT hide <ul> when clearing text nodes inside its children", () => {
    const document = createPrivacyPolicySection();
    const { nodesToClear, googleSpan, aiSpan } = simulateRegisterBlockForList(document);

    const btnAi = createMockBtnAi({ nodesToClear, googleSpan, aiSpan, aiStatus: "translating" });
    applyAiSuccessState(btnAi, { translatedText: "AI translation result" });

    // The <ul> elements must remain visible
    const uls = document.querySelectorAll("#third-parties ul");
    uls.forEach((ul, idx) => {
      expect(ul.style.display).not.toBe("none",
        `<ul> at index ${idx} should NOT be hidden`);
    });
  });

  it("should clear text content of text nodes in nodesToClear", () => {
    const document = createPrivacyPolicySection();
    const { nodesToClear, googleSpan, aiSpan } = simulateRegisterBlockForList(document);

    const btnAi = createMockBtnAi({ nodesToClear, googleSpan, aiSpan, aiStatus: "translating" });
    applyAiSuccessState(btnAi, { translatedText: "AI translation result" });

    // Text nodes should be cleared
    nodesToClear.forEach((node, idx) => {
      expect(node.textContent).toBe("",
        `Text node at index ${idx} should be cleared`);
    });
  });

  it("should hide inline wrappers (<span>, <a>) but NOT block parents (<li>)", () => {
    const html = `
      <div>
        <ul>
          <li>OpenAI (<span class="mono">api.openai.com</span>): <a href="#">Privacy</a></li>
        </ul>
      </div>
    `;
    const dom = new JSDOM(html);
    const document = dom.window.document;

    const li = document.querySelector("li");

    // Collect direct child text nodes of <li>
    const nodesToClear = [];
    for (const child of li.childNodes) {
      if (child.nodeType === 3 && child.textContent.trim()) {
        nodesToClear.push(child);
      }
    }

    const googleSpan = document.createElement("span");
    const aiSpan = document.createElement("span");

    const btnAi = createMockBtnAi({ nodesToClear, googleSpan, aiSpan, aiStatus: "translating" });
    applyAiSuccessState(btnAi, { translatedText: "translated" });

    // <li> (block element) should NOT be hidden
    expect(li.style.display).not.toBe("none",
      "<li> (block element) should NOT be hidden");

    // Text content should be cleared
    nodesToClear.forEach(node => {
      expect(node.textContent).toBe("");
    });
  });

  it("should keep <h4> headings visible after AI translation of sibling list", () => {
    const document = createPrivacyPolicySection();
    const { nodesToClear, googleSpan, aiSpan } = simulateRegisterBlockForList(document);

    const btnAi = createMockBtnAi({ nodesToClear, googleSpan, aiSpan, aiStatus: "translating" });
    applyAiSuccessState(btnAi, { translatedText: "AI translation result" });

    // All h4 headings should remain visible
    const h4s = document.querySelectorAll("#third-parties h4");
    h4s.forEach((h4, idx) => {
      expect(h4.style.display).not.toBe("none",
        `<h4> "${h4.textContent}" should remain visible`);
    });
  });

  it("should show aiSpan and hide googleSpan on success", () => {
    const document = createPrivacyPolicySection();
    const { nodesToClear, googleSpan, aiSpan } = simulateRegisterBlockForList(document);

    const btnAi = createMockBtnAi({ nodesToClear, googleSpan, aiSpan, aiStatus: "translating" });
    applyAiSuccessState(btnAi, { translatedText: "AI translation result" });

    // aiSpan should be visible with translation
    expect(aiSpan.style.display).toBe("block");
    expect(aiSpan.textContent).toBe("AI translation result");

    // googleSpan should be hidden
    expect(googleSpan.style.display).toBe("none");
  });
});
