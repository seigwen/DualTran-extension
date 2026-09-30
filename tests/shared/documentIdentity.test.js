/**
 * Document-identity primitive unit tests (plan 36).
 *
 * The canary roundtrip scenarios test a structural premise: the site
 * navigates CLIENT-SIDE (the document survives; the router rebuilds the
 * DOM — the extension must rebuild hosts and restore translation). The
 * guard compares per-document signals around a navigation:
 *   - performance.timeOrigin: minted when the document is created — a full
 *     page load ALWAYS changes it;
 *   - the executor-injected token (window.__dualtranDocToken): a
 *     defense-in-depth second signal, re-injected on every new document.
 *
 * RED calibration: under the naive "assume client-side" implementation
 * (classify returns "same-document" unconditionally; the reader returns
 * nulls), cells ①④⑤⑥ and the second half of ⑦ are red. The naive module
 * was archived before the real implementation landed.
 */

import { describe, expect, it } from "vitest";
import {
  classifyDocumentIdentity,
  readDocumentIdentityInPage,
} from "./document-identity.mjs";

describe("readDocumentIdentityInPage (browser-context reader)", () => {
  afterEach(() => {
    delete window.__dualtranDocToken;
  });

  it("① reads the injected token + performance.timeOrigin", () => {
    window.__dualtranDocToken = "tok-abc:123";
    const id = readDocumentIdentityInPage();
    expect(id.token).toBe("tok-abc:123");
    expect(typeof id.timeOrigin).toBe("number");
    expect(id.timeOrigin).toBe(performance.timeOrigin);
  });

  it("② no token injected → token null (reader never throws)", () => {
    const id = readDocumentIdentityInPage();
    expect(id.token).toBe(null);
  });
});

describe("classifyDocumentIdentity (pure logic)", () => {
  const same = { token: "tok-a", timeOrigin: 1000.5 };

  it("③ same token + same timeOrigin → same-document (client-side route)", () => {
    expect(classifyDocumentIdentity(same, { ...same })).toBe("same-document");
  });

  it("④ new timeOrigin → full-load (a new document always mints one)", () => {
    expect(classifyDocumentIdentity(same, { token: "tok-b", timeOrigin: 2000.5 })).toBe("full-load");
  });

  it("⑤ token mismatch (same timeOrigin) → full-load (defense in depth)", () => {
    expect(classifyDocumentIdentity(same, { token: "tok-b", timeOrigin: 1000.5 })).toBe("full-load");
  });

  it("⑥ missing/unreadable side → unknown (never a false drift report)", () => {
    expect(classifyDocumentIdentity(null, same)).toBe("unknown");
    expect(classifyDocumentIdentity(same, null)).toBe("unknown");
    expect(classifyDocumentIdentity({ token: "t", timeOrigin: null }, same)).toBe("unknown");
  });

  it("⑦ token missing on one side → timeOrigin decides (degraded but safe)", () => {
    expect(classifyDocumentIdentity({ token: null, timeOrigin: 1000.5 }, same)).toBe("same-document");
    expect(
      classifyDocumentIdentity({ token: null, timeOrigin: 1000.5 }, { token: null, timeOrigin: 2000.5 })
    ).toBe("full-load");
  });
});
