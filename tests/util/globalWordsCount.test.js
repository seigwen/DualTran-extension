import { describe, expect, it } from "vitest";
import wordsCount, {
  wordsCount as namedWordsCount,
  wordsSplit,
  wordsDetect,
} from "../../src/util/globalWordsCount.js";

describe("globalWordsCount", () => {
  describe("wordsDetect", () => {
    it("returns empty result for falsy input", () => {
      expect(wordsDetect(null)).toEqual({ words: [], count: 0 });
      expect(wordsDetect("")).toEqual({ words: [], count: 0 });
      expect(wordsDetect(undefined)).toEqual({ words: [], count: 0 });
    });

    it("returns empty result for whitespace-only input", () => {
      expect(wordsDetect("   ")).toEqual({ words: [], count: 0 });
      expect(wordsDetect("\t\n")).toEqual({ words: [], count: 0 });
    });

    it("counts English words", () => {
      const result = wordsDetect("Hello world");
      expect(result.count).toBe(2);
      expect(result.words).toEqual(["Hello", "world"]);
    });

    it("counts Chinese characters individually", () => {
      const result = wordsDetect("你好世界");
      expect(result.count).toBe(4);
    });

    it("counts Japanese hiragana characters individually", () => {
      const result = wordsDetect("こんにちは");
      expect(result.count).toBe(5);
    });

    it("counts Korean characters", () => {
      const result = wordsDetect("안녕하세요");
      expect(result.count).toBeGreaterThan(0);
    });

    it("handles mixed CJK and Latin text", () => {
      const result = wordsDetect("Hello 你好 world");
      expect(result.count).toBe(4);
    });

    it("strips default punctuation", () => {
      const result = wordsDetect("Hello, world!");
      expect(result.count).toBe(2);
      expect(result.words).toEqual(["Hello", "world"]);
    });

    it("treats punctuation as word breaker when punctuationAsBreaker is true", () => {
      const result = wordsDetect("one,two,three", {
        punctuationAsBreaker: true,
      });
      expect(result.count).toBe(3);
      expect(result.words).toEqual(["one", "two", "three"]);
    });

    it("keeps default punctuation when disableDefaultPunctuation is true", () => {
      const withDefault = wordsDetect("a,b");
      const withoutDefault = wordsDetect("a,b", {
        disableDefaultPunctuation: true,
      });
      expect(withoutDefault).toBeDefined();
      expect(withoutDefault.count).toBeGreaterThan(0);
    });

    it("supports custom punctuation list (strip mode)", () => {
      const result = wordsDetect("hello+world", { punctuation: ["+"] });
      expect(result.count).toBe(1);
      expect(result.words).toEqual(["helloworld"]);
    });

    it("supports custom punctuation as breaker", () => {
      const result = wordsDetect("hello+world", {
        punctuation: ["+"],
        punctuationAsBreaker: true,
      });
      expect(result.count).toBe(2);
      expect(result.words).toEqual(["hello", "world"]);
    });

    it("handles numbers", () => {
      const result = wordsDetect("test 123 foo");
      expect(result.count).toBe(3);
    });

    it("handles accented Latin characters (French, German, etc.)", () => {
      const result = wordsDetect("café résumé naïve");
      expect(result.count).toBe(3);
    });

    it("handles Cyrillic text", () => {
      const result = wordsDetect("Привет мир");
      expect(result.count).toBe(2);
    });

    it("coerces non-string input via String()", () => {
      const result = wordsDetect(12345);
      expect(result.count).toBe(1);
      expect(result.words).toEqual(["12345"]);
    });
  });

  describe("wordsCount", () => {
    it("returns count only", () => {
      expect(wordsCount("one two three")).toBe(3);
    });

    it("default export equals named export", () => {
      expect(wordsCount).toBe(namedWordsCount);
    });

    it("returns 0 for empty string", () => {
      expect(wordsCount("")).toBe(0);
    });

    it("passes config to wordsDetect", () => {
      expect(wordsCount("a,b,c", { punctuationAsBreaker: true })).toBe(3);
    });
  });

  describe("wordsSplit", () => {
    it("returns words array only", () => {
      expect(wordsSplit("Hello world")).toEqual(["Hello", "world"]);
    });

    it("returns empty array for empty string", () => {
      expect(wordsSplit("")).toEqual([]);
    });

    it("passes config through", () => {
      const result = wordsSplit("a+b", {
        punctuation: ["+"],
        punctuationAsBreaker: true,
      });
      expect(result).toEqual(["a", "b"]);
    });
  });
});
