/**
 * Tests for the feedback-link pure-function surface (plan 35 — user feedback channel).
 *
 * ── Implementation-point map ────────────────────────────────────────────
 * (CLAUDE.md rule "反馈通道": every implementation point carries a test
 * reference; this file is the unit half, `tests/browser-e2e/feedback-entry.mjs`
 * is the E2E half.)
 *
 *   - `buildIssueUrl`             → golden URLs (static / google / ai), per-field
 *                                    encoding, 2000-char budget convergence,
 *                                    "no URL without a version" contract
 *   - `detectBrowserFromUserAgent`→ bug_report.yml#browser dropdown-value mapping
 *   - `detectOsFromUserAgent`     → bug_report.yml#os dropdown-value mapping
 *                                    (incl. the Android-before-Linux /
 *                                    iOS-before-macOS ordering traps)
 *   - `mapServiceToIssueValue`    → bug_report.yml#service option mapping
 *   - `resolveProviderDisplayName`→ display-name map + id passthrough
 *   - `formatDiagnosticsBlock`    → static 6-line block, error-path extension,
 *                                    conditional-line omission
 *   - `buildMailtoUrl`            → subject/body encoding
 *   - red line (negative assertions): caller-side secrets (apiKey / apiBase /
 *     full page URL / page content) never reach any produced artifact.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { describe, expect, it } from "vitest";
import {
  buildIssueUrl,
  buildMailtoUrl,
  detectBrowserFromUserAgent,
  detectOsFromUserAgent,
  formatDiagnosticsBlock,
  mapServiceToIssueValue,
  resolveProviderDisplayName,
} from "../../src/lib/feedbackLink.js";

// ── User-agent fixtures (real desktop/mobile shapes) ────────────────────

const UA_CHROME_LINUX =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
const UA_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
const UA_EDGE_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0";
const UA_MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const UA_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Mobile Safari/537.36";
const UA_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// ── Golden URLs (byte-exact; the form field order is contract) ──────────

const GOLDEN_STATIC =
  "https://github.com/seigwen/DualTran-extension/issues/new?template=bug_report.yml&extension-version=2.1.30&browser=Chrome&os=Linux";
const GOLDEN_GOOGLE =
  "https://github.com/seigwen/DualTran-extension/issues/new?template=bug_report.yml&extension-version=2.1.30&browser=Chrome&os=Linux&service=Google+Translate&additional=Hostname%3A+x.com%0ALanguage+pair%3A+en+%E2%86%92+zh-CN%0AError%3A+boom";
const GOLDEN_AI_OPENROUTER =
  "https://github.com/seigwen/DualTran-extension/issues/new?template=bug_report.yml&extension-version=2.1.30&browser=Chrome&os=Linux&service=AI+Translation+%28Other%29&additional=Hostname%3A+x.com%0ALanguage+pair%3A+en+%E2%86%92+zh-CN%0AAI+provider%3A+OpenRouter%0AError%3A+boom";

// ──────────────────────────────────────────────────────────────
// buildIssueUrl — the three states + encoding + budget + contract
// ──────────────────────────────────────────────────────────────

describe("buildIssueUrl", () => {
  it("builds the static (options page) prefilled URL — template/version/browser/os only", () => {
    const url = buildIssueUrl({ version: "2.1.30", userAgent: UA_CHROME_LINUX });
    expect(url).toBe(GOLDEN_STATIC);
    // Static path carries no service / additional claims (a wrong guess would mislead)
    expect(new URL(url).searchParams.has("service")).toBe(false);
    expect(new URL(url).searchParams.has("additional")).toBe(false);
  });

  it("builds the Google error-path URL — service + hostname/language-pair/error context", () => {
    const url = buildIssueUrl({
      version: "2.1.30",
      userAgent: UA_CHROME_LINUX,
      serviceType: "google",
      errorText: "boom",
      hostname: "x.com",
      sourceLang: "en",
      targetLang: "zh-CN",
    });
    expect(url).toBe(GOLDEN_GOOGLE);
  });

  it("builds the AI error-path URL — provider mapped + AI provider context line", () => {
    const url = buildIssueUrl({
      version: "2.1.30",
      userAgent: UA_CHROME_LINUX,
      serviceType: "ai",
      providerId: "openrouter",
      errorText: "boom",
      hostname: "x.com",
      sourceLang: "en",
      targetLang: "zh-CN",
    });
    expect(url).toBe(GOLDEN_AI_OPENROUTER);
    // openrouter is not one of the four named dropdown entries → Other
    expect(new URL(url).searchParams.get("service")).toBe("AI Translation (Other)");
  });

  it("maps Edge + Windows through the UA tables into the URL fields", () => {
    const url = buildIssueUrl({
      version: "2.1.30",
      userAgent: UA_EDGE_WIN,
      serviceType: "google",
      errorText: "boom",
      hostname: "x.com",
      sourceLang: "en",
      targetLang: "zh-CN",
    });
    expect(url).toBe(
      "https://github.com/seigwen/DualTran-extension/issues/new?template=bug_report.yml&extension-version=2.1.30&browser=Edge&os=Windows+10%2F11&service=Google+Translate&additional=Hostname%3A+x.com%0ALanguage+pair%3A+en+%E2%86%92+zh-CN%0AError%3A+boom"
    );
  });

  it("omits the additional block when no context fields exist (service is still kept)", () => {
    const url = buildIssueUrl({
      version: "2.1.30",
      userAgent: UA_CHROME_LINUX,
      serviceType: "google",
    });
    const params = new URL(url).searchParams;
    expect(params.get("service")).toBe("Google Translate");
    expect(params.has("additional")).toBe(false);
  });

  it("produces no URL when the version is missing (an issue without a version is noise)", () => {
    expect(buildIssueUrl({})).toBe("");
    expect(buildIssueUrl({ version: "" })).toBe("");
    expect(buildIssueUrl({ version: "   " })).toBe("");
    expect(buildIssueUrl(undefined)).toBe("");
  });

  it("still builds with fallback browser/os values when the UA is missing", () => {
    expect(buildIssueUrl({ version: "2.1.30" })).toBe(
      "https://github.com/seigwen/DualTran-extension/issues/new?template=bug_report.yml&extension-version=2.1.30&browser=Other&os=Unknown"
    );
  });

  it("converges under the 2000-char budget by shrinking only the error text", () => {
    const pathological = "错".repeat(500); // ~4500 chars percent-encoded — must converge
    const url = buildIssueUrl({
      version: "2.1.30",
      userAgent: UA_CHROME_LINUX,
      serviceType: "ai",
      providerId: "openai",
      errorText: pathological,
      hostname: "x.com",
      sourceLang: "en",
      targetLang: "zh-CN",
    });

    expect(url.length).toBeLessThanOrEqual(2000);

    const additional = new URL(url).searchParams.get("additional");
    // Every other context field survives the shrink — only the error text gives
    expect(additional).toContain("Hostname: x.com");
    expect(additional).toContain("Language pair: en → zh-CN");
    expect(additional).toContain("AI provider: OpenAI");

    const errValue = additional.split("\n").find((l) => l.startsWith("Error: ")).slice("Error: ".length);
    expect(errValue.length).toBeGreaterThan(50); // not degenerate
    expect(errValue.length).toBeLessThan(500); // genuinely shrunk
    expect(pathological.startsWith(errValue)).toBe(true); // prefix, never dropped or garbled
  });

  it("clamps the error text at 500 characters even when the budget would allow more", () => {
    const long = "a".repeat(600);
    const url = buildIssueUrl({
      version: "2.1.30",
      userAgent: UA_CHROME_LINUX,
      serviceType: "google",
      errorText: long,
      hostname: "x.com",
      sourceLang: "en",
      targetLang: "zh-CN",
    });
    const errValue = new URL(url)
      .searchParams.get("additional")
      .split("\n")
      .find((l) => l.startsWith("Error: "))
      .slice("Error: ".length);
    expect(errValue).toBe("a".repeat(500));
  });

  it("red line: never carries caller fields outside the documented contract", () => {
    const url = buildIssueUrl({
      version: "2.1.30",
      userAgent: UA_CHROME_LINUX,
      serviceType: "ai",
      providerId: "openrouter",
      errorText: "boom",
      hostname: "x.com",
      sourceLang: "en",
      targetLang: "zh-CN",
      // Hostile extras a careless caller might spread — must never leak
      apiKey: "SENTINEL_KEY_123",
      apiBase: "https://SENTINEL_BASE.example/v1",
      pageUrl: "https://x.com/secret-path?token=SENTINEL_TOKEN",
      pageContent: "SENTINEL_PAGE_CONTENT",
    });
    expect(url).not.toContain("SENTINEL");
    expect(url).not.toContain("secret-path");
  });
});

// ──────────────────────────────────────────────────────────────
// UA detection tables — values must be byte-equal to the form options
// ──────────────────────────────────────────────────────────────

describe("detectBrowserFromUserAgent", () => {
  it("maps user agents to the exact bug_report.yml browser dropdown values", () => {
    expect(detectBrowserFromUserAgent(UA_CHROME_LINUX)).toBe("Chrome");
    expect(detectBrowserFromUserAgent(UA_EDGE_WIN)).toBe("Edge");
    expect(
      detectBrowserFromUserAgent(
        "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0"
      )
    ).toBe("Firefox");
    // No Chrome/Firefox token → Other (Brave shares Chrome's UA → documented Chrome, §8)
    expect(detectBrowserFromUserAgent(UA_MAC_SAFARI)).toBe("Other");
    expect(detectBrowserFromUserAgent("")).toBe("Other");
    expect(detectBrowserFromUserAgent(undefined)).toBe("Other");
  });
});

describe("detectOsFromUserAgent", () => {
  it("maps user agents to the exact bug_report.yml OS dropdown values (ordering traps included)", () => {
    expect(detectOsFromUserAgent(UA_WIN)).toBe("Windows 10/11");
    expect(
      detectOsFromUserAgent(
        "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36"
      )
    ).toBe("Windows");
    expect(detectOsFromUserAgent(UA_MAC_SAFARI)).toBe("macOS");
    expect(
      detectOsFromUserAgent(
        "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
      )
    ).toBe("ChromeOS");
    expect(detectOsFromUserAgent(UA_CHROME_LINUX)).toBe("Linux");
    // Android UAs contain "Linux" — Android must win
    expect(detectOsFromUserAgent(UA_ANDROID)).toBe("Android");
    // iPhone UAs contain "Mac OS X" — iOS must win
    expect(detectOsFromUserAgent(UA_IOS)).toBe("iOS");
    expect(detectOsFromUserAgent(undefined)).toBe("Unknown");
  });
});

// ──────────────────────────────────────────────────────────────
// Service / provider mapping — values must be byte-equal to the form options
// ──────────────────────────────────────────────────────────────

describe("mapServiceToIssueValue", () => {
  it("maps (serviceType, providerId) to the exact bug_report.yml service options", () => {
    expect(mapServiceToIssueValue("google")).toBe("Google Translate");
    expect(mapServiceToIssueValue("ai", "openai")).toBe("AI Translation (OpenAI)");
    expect(mapServiceToIssueValue("ai", "deepseek")).toBe("AI Translation (DeepSeek)");
    expect(mapServiceToIssueValue("ai", "anthropic")).toBe("AI Translation (Anthropic)");
    expect(mapServiceToIssueValue("ai", "google-gemini")).toBe("AI Translation (Google Gemini)");
    expect(mapServiceToIssueValue("ai", "openrouter")).toBe("AI Translation (Other)");
    expect(mapServiceToIssueValue("ai")).toBe("AI Translation (Other)");
    expect(mapServiceToIssueValue("bogus")).toBe("");
    expect(mapServiceToIssueValue(undefined)).toBe("");
  });
});

describe("resolveProviderDisplayName", () => {
  it("resolves provider display names with an id passthrough for unknown providers", () => {
    expect(resolveProviderDisplayName("openrouter")).toBe("OpenRouter");
    expect(resolveProviderDisplayName("openai")).toBe("OpenAI");
    expect(resolveProviderDisplayName("google-gemini")).toBe("Google Gemini");
    // Unknown / custom providers keep their raw id (still a stable searchable token)
    expect(resolveProviderDisplayName("custom-vendor")).toBe("custom-vendor");
    expect(resolveProviderDisplayName("")).toBe("");
    expect(resolveProviderDisplayName(undefined)).toBe("");
  });
});

// ──────────────────────────────────────────────────────────────
// formatDiagnosticsBlock — clipboard / mailto body
// ──────────────────────────────────────────────────────────────

describe("formatDiagnosticsBlock", () => {
  it("produces the static six-line block", () => {
    const block = formatDiagnosticsBlock({
      version: "2.1.30",
      userAgent: UA_CHROME_LINUX,
      pageService: "google",
      providerName: "OpenRouter",
      targetLang: "zh-CN",
    });
    expect(block).toBe(
      "DualTran: 2.1.30\nBrowser: Chrome\nOS: Linux\nPage translation: Google\nAI translation: OpenRouter\nTarget language: zh-CN"
    );
  });

  it("appends hostname / language pair / error lines on the error path", () => {
    const block = formatDiagnosticsBlock({
      version: "2.1.30",
      userAgent: UA_CHROME_LINUX,
      pageService: "google",
      providerName: "OpenRouter",
      targetLang: "zh-CN",
      hostname: "x.com",
      sourceLang: "en",
      errorText: "provider exploded",
    });
    expect(block.split("\n").slice(6)).toEqual([
      "Hostname: x.com",
      "Language pair: en → zh-CN",
      "Error: provider exploded",
    ]);
  });

  it("omits conditional lines when their data is absent (und source language, empty fields)", () => {
    const block = formatDiagnosticsBlock({
      version: "2.1.30",
      userAgent: UA_CHROME_LINUX,
      pageService: "google",
      providerName: "OpenRouter",
      targetLang: "zh-CN",
      sourceLang: "und",
      hostname: "",
      errorText: "",
    });
    expect(block).toBe(
      "DualTran: 2.1.30\nBrowser: Chrome\nOS: Linux\nPage translation: Google\nAI translation: OpenRouter\nTarget language: zh-CN"
    );
  });

  it("red line: never emits injected secrets or the full page URL", () => {
    const block = formatDiagnosticsBlock({
      version: "2.1.30",
      userAgent: UA_CHROME_LINUX,
      pageService: "google",
      providerName: "OpenRouter",
      targetLang: "zh-CN",
      hostname: "x.com",
      sourceLang: "en",
      errorText: "boom",
      apiKey: "SENTINEL_KEY_123",
      apiBase: "https://SENTINEL_BASE.example/v1",
      pageUrl: "https://x.com/secret-path?token=SENTINEL_TOKEN",
    });
    expect(block).not.toContain("SENTINEL");
    expect(block).not.toContain("secret-path");
  });
});

// ──────────────────────────────────────────────────────────────
// buildMailtoUrl — the no-GitHub-account fallback
// ──────────────────────────────────────────────────────────────

describe("buildMailtoUrl", () => {
  it("builds the versioned mailto fallback with an encoded body", () => {
    expect(buildMailtoUrl({ version: "2.1.30", body: "Line1\nLine2" })).toBe(
      "mailto:seigwen@gmail.com?subject=%5BDualTran%20v2.1.30%5D&body=Line1%0ALine2"
    );
  });

  it("builds the subject without a body when none is provided", () => {
    expect(buildMailtoUrl({ version: "2.1.30" })).toBe(
      "mailto:seigwen@gmail.com?subject=%5BDualTran%20v2.1.30%5D"
    );
  });
});
