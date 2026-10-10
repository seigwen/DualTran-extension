/**
 * Self-test for the i18n sentinel classifier (spec 47 §2.2; issue #157).
 *
 * The sentinel is a full-name runtime guard: under the sentinel locale every
 * legitimate visible string carries `⟦`. These fixtures prove the classifier
 * FIRES on the #155 defect class and stays quiet on the three allowlist layers
 * — a detector that is never proven to fire is no guard at all (repo rule:
 * new assertions must be negatively calibrated on clean products).
 */
import { describe, expect, it } from "vitest";
import {
  buildRegisterMap,
  classifyItem,
  classifyItems,
  SENTINEL_MARK,
} from "./i18n-sentinel-rules.mjs";

describe("i18n sentinel rules", () => {
  it("passes sentinelized text (layer 0)", () => {
    const res = classifyItem({ kind: "text", text: `${SENTINEL_MARK}lblSettings${SENTINEL_MARK}` });
    expect(res.verdict).toBe("pass");
    expect(res.layer).toBe("sentinel");
  });

  it("flags hardcoded English — the #155 defect class", () => {
    expect(classifyItem({ kind: "text", text: "OpenAI API Key" }).verdict).toBe("violation");
    expect(classifyItem({ kind: "title", text: "Show Google translation" }).verdict).toBe("violation");
    expect(classifyItem({ kind: "text", text: "Loading..." }).verdict).toBe("violation");
    expect(classifyItem({ kind: "placeholder", text: "Enter a shortcut" }).verdict).toBe("violation");
  });

  it("allows non-text shapes (layer 1b): numbers, symbols, URLs, emails", () => {
    for (const text of ["1.0", "0", "1280×720", "—", "12:34", "https://openrouter.ai/docs", "seigwen@gmail.com"]) {
      const res = classifyItem({ kind: "text", text });
      expect(res.verdict, text).toBe("pass");
      expect(res.layer, text).toBe("non-text");
    }
  });

  it("allows language options — value is a language code (layer 1a)", () => {
    const res = classifyItem({ kind: "option", text: "English", optionValue: "en" });
    expect(res.verdict).toBe("pass");
    expect(res.layer).toBe("lang-option");
    expect(classifyItem({ kind: "option", text: "简体中文", optionValue: "zh-CN" }).verdict).toBe("pass");
    expect(classifyItem({ kind: "option", text: "Undetermined", optionValue: "und" }).verdict).toBe("pass");
    // languages.js legacy keys are still language-data values
    expect(classifyItem({ kind: "option", text: "Kazakh (Latin)", optionValue: "kazlat" }).verdict).toBe("pass");
    expect(classifyItem({ kind: "option", text: "Uzbek (Cyrillic)", optionValue: "uzbcyr" }).verdict).toBe("pass");
  });

  it("allows user-content containers (#eOrigText — the text being translated)", () => {
    const res = classifyItem(
      { kind: "text", text: "Select this English sentence to trigger the panel", path: "pierce(selection-panel)>div#eDivResult>div>div#eOrigText>span" },
      {}
    );
    expect(res.verdict).toBe("pass");
    expect(res.layer).toBe("data-container");
    // Outside such containers the same text must still fail.
    expect(
      classifyItem({ kind: "text", text: "Select this English sentence to trigger the panel", path: "pierce(selection-panel)>div#eDivResult>div>span" }).verdict
    ).toBe("violation");
  });

  it("allows registry-data selects (provider display names, layer 1a)", () => {
    const res = classifyItem(
      { kind: "option", text: "302.AI", optionValue: "302ai", selectId: "aiProvider" },
      {}
    );
    expect(res.verdict).toBe("pass");
    expect(res.layer).toBe("data-select");
    // Outside the declared data select the same text must still fail.
    expect(classifyItem({ kind: "option", text: "302.AI", optionValue: "302ai", selectId: "other" }).verdict).toBe("violation");
  });

  it("allows data values — option text identical to its value (model ids)", () => {
    const res = classifyItem({ kind: "option", text: "gpt-4o-mini", optionValue: "gpt-4o-mini" });
    expect(res.verdict).toBe("pass");
    expect(res.layer).toBe("data-value");
  });

  it("allows declared brand / provider tokens (layer 1c)", () => {
    const ctx = { allowTokens: new Set(["DualTran", "OpenAI"]) };
    expect(classifyItem({ kind: "text", text: "DualTran" }, ctx).verdict).toBe("pass");
    expect(classifyItem({ kind: "text", text: "OpenAI" }, ctx).layer).toBe("token");
  });

  it("honors the written register (layer 3, exact match)", () => {
    const register = buildRegisterMap([
      { text: "Original", category: "legacy", reason: "floating button label; fix #157 b3" },
    ]);
    const res = classifyItem({ kind: "text", text: "Original" }, { register });
    expect(res.verdict).toBe("pass");
    expect(res.layer).toBe("register:legacy");
    // Non-registered sibling text still fails — the register is exact-match.
    expect(classifyItem({ kind: "text", text: "Original copy" }, { register }).verdict).toBe("violation");
  });

  it("rejects malformed register entries (no reason, bad category, duplicates)", () => {
    expect(() => buildRegisterMap([{ text: "X", category: "legacy", reason: "" }])).toThrow(/reason/);
    expect(() => buildRegisterMap([{ text: "X", category: "bogus", reason: "r" }])).toThrow(/category/);
    expect(() =>
      buildRegisterMap([
        { text: "X", category: "legacy", reason: "r" },
        { text: "X", category: "data", reason: "r" },
      ])
    ).toThrow(/duplicate/);
  });

  it("tracks which register entries were hit (stale report input)", () => {
    const register = buildRegisterMap([
      { text: "Hit", category: "data", reason: "hit during run" },
      { text: "Never", category: "legacy", reason: "stale — should be removed" },
    ]);
    const { violations, matchedRegister } = classifyItems(
      [
        { kind: "text", text: "Hit" },
        { kind: "text", text: "Not registered" },
      ],
      register,
      new Set()
    );
    expect(violations.map((v) => v.text)).toEqual(["Not registered"]);
    expect([...matchedRegister]).toEqual(["Hit"]);
  });
});
