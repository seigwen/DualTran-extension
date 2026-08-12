/**
 * Tests for aiUiState.js nodesToClear behavior.
 *
 * Bug 1 (fixed): applyAiSuccessState hid ALL parent elements of cleared text nodes,
 * including block-level elements like <li>, causing entire subsections to disappear.
 *
 * Bug 2 (fixed): Even after restricting to inline-only parents, inline wrappers like
 * <span class="mono"> were hidden. If a node in nodesToClear had no matching entry
 * in nodesToRestore, the parent stayed hidden forever, losing content like "api.deepseek.com".
 *
 * Fix: Do NOT hide any parent elements. Only clear text content. Element nodes
 * (nodeType === 1) are still hidden with display:none.
 */

import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import {
  applyAiSuccessState,
  applyAiTranslatingState,
} from "../../src/contentScript/aiUiState.js";

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

function simulateRegisterBlockForList(document) {
  const lis = document.querySelectorAll("#third-parties ul li");
  const nodesToClear = [];

  lis.forEach((li) => {
    for (const child of li.childNodes) {
      if (child.nodeType === 3 && child.textContent.trim()) {
        nodesToClear.push(child);
      }
    }
  });

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

describe("aiUiState — nodesToClear must not hide any parent elements", () => {
  it("should NOT hide <li> parent when clearing a text node inside it", () => {
    const document = createPrivacyPolicySection();
    const { nodesToClear, googleSpan, aiSpan } = simulateRegisterBlockForList(document);
    const btnAi = createMockBtnAi({ nodesToClear, googleSpan, aiSpan, aiStatus: "translating" });

    applyAiSuccessState(btnAi, { translatedText: "AI translation result" });

    const lis = document.querySelectorAll("#third-parties ul li");
    lis.forEach((li, idx) => {
      expect(li.style.display).not.toBe("none",
        `<li> at index ${idx} should NOT be hidden`);
    });
  });

  it("should NOT hide <ul> when clearing text nodes inside its children", () => {
    const document = createPrivacyPolicySection();
    const { nodesToClear, googleSpan, aiSpan } = simulateRegisterBlockForList(document);
    const btnAi = createMockBtnAi({ nodesToClear, googleSpan, aiSpan, aiStatus: "translating" });

    applyAiSuccessState(btnAi, { translatedText: "AI translation result" });

    const uls = document.querySelectorAll("#third-parties ul");
    uls.forEach((ul, idx) => {
      expect(ul.style.display).not.toBe("none",
        `<ul> at index ${idx} should NOT be hidden`);
    });
  });

  it("should NOT hide <span class='mono'> parent of cleared text node", () => {
    const document = createPrivacyPolicySection();
    const { nodesToClear, googleSpan, aiSpan } = simulateRegisterBlockForList(document);
    const btnAi = createMockBtnAi({ nodesToClear, googleSpan, aiSpan, aiStatus: "translating" });

    applyAiSuccessState(btnAi, { translatedText: "AI translation result" });

    // <span class="mono"> elements must remain visible
    const spans = document.querySelectorAll("#third-parties span.mono");
    spans.forEach((span, idx) => {
      expect(span.style.display).not.toBe("none",
        `<span class="mono"> at index ${idx} should NOT be hidden — it contains provider URLs`);
    });
  });

  it("should NOT hide <a> parent of cleared text node", () => {
    const document = createPrivacyPolicySection();
    const { nodesToClear, googleSpan, aiSpan } = simulateRegisterBlockForList(document);
    const btnAi = createMockBtnAi({ nodesToClear, googleSpan, aiSpan, aiStatus: "translating" });

    applyAiSuccessState(btnAi, { translatedText: "AI translation result" });

    // <a> elements must remain visible
    const links = document.querySelectorAll("#third-parties a");
    links.forEach((a, idx) => {
      expect(a.style.display).not.toBe("none",
        `<a> at index ${idx} should NOT be hidden`);
    });
  });

  it("should clear text content of text nodes in nodesToClear", () => {
    const document = createPrivacyPolicySection();
    const { nodesToClear, googleSpan, aiSpan } = simulateRegisterBlockForList(document);
    const btnAi = createMockBtnAi({ nodesToClear, googleSpan, aiSpan, aiStatus: "translating" });

    applyAiSuccessState(btnAi, { translatedText: "AI translation result" });

    nodesToClear.forEach((node, idx) => {
      expect(node.textContent).toBe("",
        `Text node at index ${idx} should be cleared`);
    });
  });

  it("should keep <h4> headings visible after AI translation", () => {
    const document = createPrivacyPolicySection();
    const { nodesToClear, googleSpan, aiSpan } = simulateRegisterBlockForList(document);
    const btnAi = createMockBtnAi({ nodesToClear, googleSpan, aiSpan, aiStatus: "translating" });

    applyAiSuccessState(btnAi, { translatedText: "AI translation result" });

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

    expect(aiSpan.style.display).toBe("block");
    expect(aiSpan.textContent).toBe("AI translation result");
    expect(googleSpan.style.display).toBe("none");
  });

  it("applyAiTranslatingState should also NOT hide parent elements", () => {
    const document = createPrivacyPolicySection();
    const { nodesToClear, googleSpan, aiSpan } = simulateRegisterBlockForList(document);
    const btnAi = createMockBtnAi({ nodesToClear, googleSpan, aiSpan, aiStatus: "idle" });

    applyAiTranslatingState(btnAi, { translatedText: "translating..." });

    // All parent elements should remain visible
    const spans = document.querySelectorAll("#third-parties span.mono");
    spans.forEach((span, idx) => {
      expect(span.style.display).not.toBe("none",
        `<span class="mono"> should NOT be hidden during translating state`);
    });

    const lis = document.querySelectorAll("#third-parties ul li");
    lis.forEach((li, idx) => {
      expect(li.style.display).not.toBe("none",
        `<li> should NOT be hidden during translating state`);
    });
  });
});
