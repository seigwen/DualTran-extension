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
 */

import { beforeEach, describe, expect, it } from "vitest";
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
