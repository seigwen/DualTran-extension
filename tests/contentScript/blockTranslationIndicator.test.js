/**
 * Tests for block-level translation loading/error indicators.
 *
 * The indicator function `setBlockTranslationIndicator` manages small inline
 * spinners/error icons next to each paragraph being translated.
 *
 * - "google" type: green (#16a34a) spinner
 * - "ai" type: purple (#7c3aed) spinner
 * - state: "loading" | "error" | "done"
 * - Indicators are inserted as inline <span> elements after the target node
 * - Each (targetNode, translationType) pair is idempotent — no duplicate DOM
 * - position (5th arg): "after" (default) | "before" | "append"
 *   * "after"  — immediately after the target node (Google's anchor)
 *   * "before" — immediately before the target node (AI anchor in newLine:
 *                the target is the <translated> container, so the spinner
 *                tails the source text the user is reading)
 *   * "append" — last child of the target node (AI anchor in replaceOriginal:
 *                the target IS the block, so the spinner trails its text)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { setBlockTranslationIndicator } from "../../src/contentScript/blockTranslationIndicator.js";

function createParagraph(text) {
  const p = document.createElement("p");
  p.textContent = text;
  document.body.appendChild(p);
  return p;
}

function getSpinnerAfter(node) {
  let sibling = node.nextSibling;
  while (sibling) {
    if (
      sibling.nodeType === 1 &&
      sibling.classList &&
      sibling.classList.contains("dualtran-block-spinner")
    ) {
      return sibling;
    }
    sibling = sibling.nextSibling;
  }
  return null;
}

function getIndicatorAfter(node, type) {
  let sibling = node.nextSibling;
  while (sibling) {
    if (
      sibling.nodeType === 1 &&
      sibling.classList &&
      sibling.classList.contains("dualtran-block-indicator") &&
      sibling.dataset.type === type
    ) {
      return sibling;
    }
    sibling = sibling.nextSibling;
  }
  return null;
}

function getIndicatorBefore(node, type) {
  let sibling = node.previousSibling;
  while (sibling) {
    if (
      sibling.nodeType === 1 &&
      sibling.classList &&
      sibling.classList.contains("dualtran-block-indicator") &&
      sibling.dataset.type === type
    ) {
      return sibling;
    }
    sibling = sibling.previousSibling;
  }
  return null;
}

function getIndicatorInside(node, type) {
  const children = node.children || [];
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (
      child.classList &&
      child.classList.contains("dualtran-block-indicator") &&
      child.dataset.type === type
    ) {
      return child;
    }
  }
  return null;
}

describe("setBlockTranslationIndicator", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("inserts a green loading spinner for Google translation", () => {
    const p = createParagraph("Hello world");
    setBlockTranslationIndicator(p, "google", "loading");

    const indicator = getIndicatorAfter(p, "google");
    expect(indicator).not.toBeNull();
    expect(indicator.classList.contains("dualtran-block-spinner")).toBe(true);
    expect(indicator.dataset.type).toBe("google");
    expect(indicator.dataset.state).toBe("loading");
    expect(indicator.style.color).toContain("22, 163, 74"); // green
  });

  it("inserts a purple loading spinner for AI translation", () => {
    const p = createParagraph("Hello world");
    setBlockTranslationIndicator(p, "ai", "loading");

    const indicator = getIndicatorAfter(p, "ai");
    expect(indicator).not.toBeNull();
    expect(indicator.classList.contains("dualtran-block-spinner")).toBe(true);
    expect(indicator.dataset.type).toBe("ai");
    expect(indicator.dataset.state).toBe("loading");
    expect(indicator.style.color).toContain("124, 58, 237"); // purple
  });

  it("removes spinner when state changes to done", () => {
    const p = createParagraph("Hello world");
    setBlockTranslationIndicator(p, "google", "loading");
    expect(getIndicatorAfter(p, "google")).not.toBeNull();

    setBlockTranslationIndicator(p, "google", "done");
    expect(getIndicatorAfter(p, "google")).toBeNull();
  });

  it("replaces spinner with error icon when state changes to error", () => {
    const p = createParagraph("Hello world");
    setBlockTranslationIndicator(p, "ai", "loading");
    expect(getIndicatorAfter(p, "ai")).not.toBeNull();

    setBlockTranslationIndicator(p, "ai", "error", "API key missing");
    const indicator = getIndicatorAfter(p, "ai");
    expect(indicator).not.toBeNull();
    expect(indicator.classList.contains("dualtran-block-error")).toBe(true);
    expect(indicator.classList.contains("dualtran-block-spinner")).toBe(false);
    expect(indicator.title).toBe("API key missing");
    expect(indicator.dataset.type).toBe("ai");
    expect(indicator.dataset.state).toBe("error");
  });

  it("is idempotent — repeated loading calls do not create duplicate indicators", () => {
    const p = createParagraph("Hello world");
    setBlockTranslationIndicator(p, "google", "loading");
    setBlockTranslationIndicator(p, "google", "loading");
    setBlockTranslationIndicator(p, "google", "loading");

    // Count indicators of type "google" after p
    let count = 0;
    let sibling = p.nextSibling;
    while (sibling) {
      if (
        sibling.nodeType === 1 &&
        sibling.classList &&
        sibling.classList.contains("dualtran-block-indicator") &&
        sibling.dataset.type === "google"
      ) {
        count++;
      }
      sibling = sibling.nextSibling;
    }
    expect(count).toBe(1);
  });

  it("allows two independent indicators (green + purple) on the same node", () => {
    const p = createParagraph("Hello world");
    setBlockTranslationIndicator(p, "google", "loading");
    setBlockTranslationIndicator(p, "ai", "loading");

    const google = getIndicatorAfter(p, "google");
    const ai = getIndicatorAfter(p, "ai");
    expect(google).not.toBeNull();
    expect(ai).not.toBeNull();
    expect(google).not.toBe(ai);
  });

  it("removes Google indicator independently while AI indicator remains", () => {
    const p = createParagraph("Hello world");
    setBlockTranslationIndicator(p, "google", "loading");
    setBlockTranslationIndicator(p, "ai", "loading");

    setBlockTranslationIndicator(p, "google", "done");

    expect(getIndicatorAfter(p, "google")).toBeNull();
    expect(getIndicatorAfter(p, "ai")).not.toBeNull();
  });

  it("removes AI indicator independently while Google indicator remains", () => {
    const p = createParagraph("Hello world");
    setBlockTranslationIndicator(p, "google", "loading");
    setBlockTranslationIndicator(p, "ai", "loading");

    setBlockTranslationIndicator(p, "ai", "done");

    expect(getIndicatorAfter(p, "google")).not.toBeNull();
    expect(getIndicatorAfter(p, "ai")).toBeNull();
  });

  it("calling done on a node with no existing indicator is a no-op", () => {
    const p = createParagraph("Hello world");
    // Should not throw
    expect(() => setBlockTranslationIndicator(p, "google", "done")).not.toThrow();
    expect(getIndicatorAfter(p, "google")).toBeNull();
  });

  it("calling error on a node with no existing indicator creates error icon directly", () => {
    const p = createParagraph("Hello world");
    setBlockTranslationIndicator(p, "ai", "error", "timeout");

    const indicator = getIndicatorAfter(p, "ai");
    expect(indicator).not.toBeNull();
    expect(indicator.classList.contains("dualtran-block-error")).toBe(true);
    expect(indicator.title).toBe("timeout");
  });

  it("error icon uses the correct type color (green for Google, purple for AI)", () => {
    const p = createParagraph("Hello world");
    setBlockTranslationIndicator(p, "google", "error", "network error");
    const googleErr = getIndicatorAfter(p, "google");
    expect(googleErr.style.color).toContain("22, 163, 74"); // green

    const p2 = createParagraph("Another paragraph");
    setBlockTranslationIndicator(p2, "ai", "error", "API error");
    const aiErr = getIndicatorAfter(p2, "ai");
    expect(aiErr.style.color).toContain("124, 58, 237"); // purple
  });
});

// ──────────────────────────────────────────────────────────────
// position support ("before" / "append") — added for the AI block
// indicator inline anchor. The AI spinner must sit inline at the end of the
// text the user is reading instead of on its own line below the block.
// ──────────────────────────────────────────────────────────────

describe("setBlockTranslationIndicator — position support", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  /** Mirrors the newLine DOM: <p> original text + <translated> block. */
  function createParagraphWithTranslated(text) {
    const p = document.createElement("p");
    p.appendChild(document.createTextNode(text));
    const translated = document.createElement("translated");
    translated.style.display = "block";
    p.appendChild(translated);
    document.body.appendChild(p);
    return { p, translated };
  }

  it('position="before": spinner is inserted immediately before the target node', () => {
    const { p, translated } = createParagraphWithTranslated("Hello world");

    setBlockTranslationIndicator(translated, "ai", "loading", undefined, "before");

    const indicator = getIndicatorBefore(translated, "ai");
    expect(indicator).not.toBeNull();
    expect(indicator.classList.contains("dualtran-block-spinner")).toBe(true);
    expect(indicator.dataset.state).toBe("loading");
    expect(indicator.nextSibling).toBe(translated);
    expect(indicator.parentNode).toBe(p);
    // Must NOT fall back to the default "after" anchor
    expect(getIndicatorAfter(translated, "ai")).toBeNull();
  });

  it('position="before": done removes the before-anchored indicator', () => {
    const { translated } = createParagraphWithTranslated("Hello world");
    setBlockTranslationIndicator(translated, "ai", "loading", undefined, "before");
    expect(getIndicatorBefore(translated, "ai")).not.toBeNull();

    setBlockTranslationIndicator(translated, "ai", "done", undefined, "before");
    expect(getIndicatorBefore(translated, "ai")).toBeNull();
  });

  it('position="before": error replaces the before-anchored spinner with the error icon', () => {
    const { translated } = createParagraphWithTranslated("Hello world");
    setBlockTranslationIndicator(translated, "ai", "loading", undefined, "before");

    setBlockTranslationIndicator(translated, "ai", "error", "stream died", "before");
    const indicator = getIndicatorBefore(translated, "ai");
    expect(indicator).not.toBeNull();
    expect(indicator.classList.contains("dualtran-block-error")).toBe(true);
    expect(indicator.title).toBe("stream died");
  });

  it('position="before": is idempotent across repeated loading calls', () => {
    const { p, translated } = createParagraphWithTranslated("Hello world");
    setBlockTranslationIndicator(translated, "ai", "loading", undefined, "before");
    setBlockTranslationIndicator(translated, "ai", "loading", undefined, "before");
    setBlockTranslationIndicator(translated, "ai", "loading", undefined, "before");

    expect(p.querySelectorAll(':scope > .dualtran-block-indicator[data-type="ai"]').length).toBe(1);
  });

  it('position="append": spinner becomes the last child of the target node', () => {
    const p = createParagraph("Hello world");
    const aiSpan = document.createElement("span");
    aiSpan.className = "dualtran-aitranslatedtext-replacemode";
    p.appendChild(aiSpan);

    setBlockTranslationIndicator(p, "ai", "loading", undefined, "append");

    const indicator = getIndicatorInside(p, "ai");
    expect(indicator).not.toBeNull();
    expect(indicator.parentNode).toBe(p);
    expect(indicator.previousSibling).toBe(aiSpan);
    expect(p.lastElementChild).toBe(indicator);
    // Must NOT be anchored after the block
    expect(getIndicatorAfter(p, "ai")).toBeNull();
  });

  it('position="append": done removes the appended indicator', () => {
    const p = createParagraph("Hello world");
    setBlockTranslationIndicator(p, "ai", "loading", undefined, "append");
    expect(getIndicatorInside(p, "ai")).not.toBeNull();

    setBlockTranslationIndicator(p, "ai", "done", undefined, "append");
    expect(getIndicatorInside(p, "ai")).toBeNull();
    // The removal must not disturb the block's own children
    expect(p.textContent).toBe("Hello world");
  });

  it('position="append": error replaces the appended spinner with the error icon', () => {
    const p = createParagraph("Hello world");
    setBlockTranslationIndicator(p, "ai", "loading", undefined, "append");

    setBlockTranslationIndicator(p, "ai", "error", "provider 503", "append");
    const indicator = getIndicatorInside(p, "ai");
    expect(indicator).not.toBeNull();
    expect(indicator.classList.contains("dualtran-block-error")).toBe(true);
    expect(indicator.title).toBe("provider 503");
  });

  it('negative control: the default "after" anchor stays unchanged (Google path)', () => {
    const p = createParagraph("Hello world");
    setBlockTranslationIndicator(p, "google", "loading");

    const indicator = getIndicatorAfter(p, "google");
    expect(indicator).not.toBeNull();
    expect(indicator.previousSibling).toBe(p);
    expect(getIndicatorInside(p, "google")).toBeNull();
    // And the "before" lookup must not see it
    expect(getIndicatorBefore(p, "google")).toBeNull();
  });

  it('cross-position isolation: done with "before" does not remove an "after" indicator', () => {
    const p = createParagraph("Hello world");
    // Two indicators on the same target with different anchors (defensive:
    // position-scoped lookup must not over-delete).
    setBlockTranslationIndicator(p, "ai", "loading"); // default "after"
    setBlockTranslationIndicator(p, "ai", "loading", undefined, "before");

    setBlockTranslationIndicator(p, "ai", "done", undefined, "before");

    expect(getIndicatorBefore(p, "ai")).toBeNull();
    expect(getIndicatorAfter(p, "ai")).not.toBeNull();
  });

  it('mixed types and positions: google(after) + ai(before) coexist with independent lifecycles', () => {
    const { translated } = createParagraphWithTranslated("Hello world");
    setBlockTranslationIndicator(translated, "google", "loading"); // after (Google's anchor)
    setBlockTranslationIndicator(translated, "ai", "loading", undefined, "before");

    expect(getIndicatorAfter(translated, "google")).not.toBeNull();
    expect(getIndicatorBefore(translated, "ai")).not.toBeNull();

    setBlockTranslationIndicator(translated, "ai", "done", undefined, "before");
    expect(getIndicatorBefore(translated, "ai")).toBeNull();
    expect(getIndicatorAfter(translated, "google")).not.toBeNull();
  });

  it("insertion is a no-op when the target has no parent node", () => {
    const orphan = document.createElement("translated");
    expect(() => setBlockTranslationIndicator(orphan, "ai", "loading", undefined, "before")).not.toThrow();
    expect(orphan.childNodes.length).toBe(0);
  });
});
