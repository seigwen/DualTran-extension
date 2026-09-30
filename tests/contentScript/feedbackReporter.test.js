/**
 * Tests for the content-script feedback reporter (plan 35 — user feedback channel).
 *
 * `installFeedbackReporter({ getContext, send })` installs a document-level
 * delegated click listener: clicking a block-level error icon
 * (`.dualtran-block-error`) sends one `openFeedbackIssue` payload carrying the
 * icon's own data (service type, error text) plus the page context
 * (hostname / language pair) from `getContext()`.
 *
 * Red line (asserted here as negative cells): the payload never contains API
 * keys, API base configs, page content, or the full URL — only what the
 * reporter explicitly collects.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFeedbackReporter } from "../../src/contentScript/feedbackReporter.js";

function createErrorIcon({ type = "ai", message = "Translation error" } = {}) {
  const span = document.createElement("span");
  span.className = "dualtran-block-indicator dualtran-block-error";
  span.dataset.type = type;
  span.dataset.state = "error";
  span.textContent = "⚠";
  span.title = message;
  document.body.appendChild(span);
  return span;
}

describe("installFeedbackReporter", () => {
  let send;
  let getContext;

  beforeEach(() => {
    document.body.innerHTML = "";
    send = vi.fn();
    getContext = vi.fn(() => ({
      hostname: "x.com",
      sourceLang: "en",
      targetLang: "zh-CN",
    }));
  });

  it("sends the openFeedbackIssue payload when a google error icon is clicked", () => {
    installFeedbackReporter({ getContext, send });
    const icon = createErrorIcon({ type: "google", message: "429 quota" });

    icon.click();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      action: "openFeedbackIssue",
      serviceType: "google",
      errorText: "429 quota",
      hostname: "x.com",
      sourceLang: "en",
      targetLang: "zh-CN",
    });
  });

  it("sends the openFeedbackIssue payload when an ai error icon is clicked", () => {
    installFeedbackReporter({ getContext, send });
    const icon = createErrorIcon({ type: "ai", message: "provider 503" });

    icon.click();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      action: "openFeedbackIssue",
      serviceType: "ai",
      errorText: "provider 503",
      hostname: "x.com",
      sourceLang: "en",
      targetLang: "zh-CN",
    });
  });

  it("works via inner-element clicks (delegation, not direct binding)", () => {
    installFeedbackReporter({ getContext, send });
    const icon = createErrorIcon({ type: "ai", message: "nested click" });
    // A click landing on a child node of the icon must still resolve
    const inner = document.createElement("b");
    icon.appendChild(inner);

    inner.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].errorText).toBe("nested click");
  });

  it("ignores clicks on non-error elements", () => {
    installFeedbackReporter({ getContext, send });
    const p = document.createElement("p");
    p.textContent = "plain paragraph";
    document.body.appendChild(p);
    const spinner = document.createElement("span");
    spinner.className = "dualtran-block-indicator dualtran-block-spinner";
    document.body.appendChild(spinner);

    p.click();
    spinner.click();

    expect(send).not.toHaveBeenCalled();
  });

  it("tolerates missing icon fields and missing context values (no crash, no fabrication)", () => {
    getContext = vi.fn(() => ({}));
    installFeedbackReporter({ getContext, send });
    const icon = document.createElement("span");
    icon.className = "dualtran-block-error";
    // No dataset.type, no title at all
    document.body.appendChild(icon);

    expect(() => icon.click()).not.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][0];
    expect(payload.action).toBe("openFeedbackIssue");
    expect(payload.serviceType).toBe("");
    expect(payload.errorText).toBe("");
    expect(payload.hostname).toBe("");
    expect(payload.sourceLang).toBe("");
    expect(payload.targetLang).toBe("");
  });

  it("is idempotent across repeated installs (one click, one send)", () => {
    installFeedbackReporter({ getContext, send });
    installFeedbackReporter({ getContext, send });
    installFeedbackReporter({ getContext, send });

    const icon = createErrorIcon({ type: "ai", message: "once" });
    icon.click();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("red line: the payload carries no secrets even when the context object leaks them", () => {
    getContext = vi.fn(() => ({
      hostname: "x.com",
      sourceLang: "en",
      targetLang: "zh-CN",
      apiKey: "SENTINEL_KEY_123",
      apiBase: "https://SENTINEL_BASE.example/v1",
      pageUrl: "https://x.com/secret-path?token=SENTINEL_TOKEN",
      pageContent: "SENTINEL_PAGE_CONTENT",
    }));
    installFeedbackReporter({ getContext, send });
    const icon = createErrorIcon({ type: "ai", message: "boom" });

    icon.click();

    const serialized = JSON.stringify(send.mock.calls[0][0]);
    expect(serialized).not.toContain("SENTINEL");
    expect(serialized).not.toContain("secret-path");
    // The payload is a closed shape — exactly these keys, nothing spread through
    expect(Object.keys(send.mock.calls[0][0]).sort()).toEqual([
      "action",
      "errorText",
      "hostname",
      "serviceType",
      "sourceLang",
      "targetLang",
    ]);
  });
});
