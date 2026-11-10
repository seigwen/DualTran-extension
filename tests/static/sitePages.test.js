import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOCS = path.join(ROOT, "docs");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// The store listing points at a rendered privacy page now. If that page or the
// link ever drifts, Chrome/Edge/AMO review can reject the listing while the
// extension itself still works — a failure nobody notices until submission.
describe("public site pages", () => {
  it("ships a privacy page that answers the store questionnaire", () => {
    const privacy = read("docs/privacy.html");
    expect(privacy).toContain('lang="en"');
    for (const id of ["overview", "collect", "leaves", "stored", "third-parties", "contact"]) {
      expect(privacy).toContain(`id="${id}"`);
    }
    expect(privacy).toContain("translate.googleapis.com");
    expect(privacy).toContain("seigwen@gmail.com");
    // English-only page: a CJK leak means copy was pasted from the Chinese site.
    expect(privacy).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it("points every store reference at the rendered privacy page", () => {
    const listing = JSON.parse(read("store/listing.json"));
    expect(listing.shared.privacy).toBe(
      "https://seigwen.github.io/DualTran-extension/privacy.html",
    );
    for (const rel of ["docs/store/chrome-listing.md", "docs/store/samsung-listing.md"]) {
      expect(read(rel)).toContain(listing.shared.privacy);
    }
  });

  it("keeps the English landing page linked both ways", () => {
    const en = read("docs/en/index.html");
    expect(en).toContain('lang="en"');
    expect(en).toContain("Read foreign pages. Keep the original.");
    expect(en).toContain('href="../index.html"');
    expect(en).toContain('href="../privacy.html"');
    expect(en).toContain('href="./vs.html"');

    const zh = read("docs/index.html");
    expect(zh).toContain('href="./en/"');
    expect(zh).toContain('href="./privacy.html"');
  });

  it("ships an English comparison page that names the competitor honestly", () => {
    const en = read("docs/en/vs.html");
    expect(en).toContain("Immersive Translate alternative");
    // The comparison must stay fair: claiming DualTran is more mature would be false.
    expect(en.toLowerCase()).toContain("more mature");
    expect(read("docs/vs.html")).toContain('href="./en/vs.html"');
  });
});
