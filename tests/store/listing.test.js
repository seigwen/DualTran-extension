import { describe, expect, it } from "vitest";
import listing from "../../store/listing.json";

/**
 * The listing is a release artefact (plan 85). These are the invariants the AMO audit
 * enforces at runtime, kept here so a bad copy edit fails in CI instead of on the store page.
 */
describe("store listing copy", () => {
  for (const locale of ["zh-CN", "en-US"]) {
    it(`${locale}: description is long enough to be useful`, () => {
      expect(listing.locales[locale].description.length).toBeGreaterThanOrEqual(400);
    });

    it(`${locale}: summary fits the store field`, () => {
      const summary = listing.locales[locale].summary;
      // CJK packs more meaning per character, so the floor differs by locale.
      expect(summary.length).toBeGreaterThanOrEqual(locale === "zh-CN" ? 20 : 40);
      expect(summary.length).toBeLessThanOrEqual(250);
    });

    it(`${locale}: keeps the claims the product is sold on`, () => {
      const description = listing.locales[locale].description;
      expect(description).toMatch(/20\+/);
      expect(description).toMatch(/API Key|API key/);
    });

    it(`${locale}: has no placeholder text`, () => {
      expect(listing.locales[locale].description).not.toMatch(/lorem|TODO|占位/);
    });
  }

  it("names the channels that must be audited", () => {
    for (const channel of ["amo", "obsidian", "npm", "chrome", "edge", "opera", "utools", "outlook"]) {
      expect(listing.channels[channel], channel).toBeTruthy();
    }
  });
});
