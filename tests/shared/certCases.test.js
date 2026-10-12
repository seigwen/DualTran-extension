/**
 * Tests for tests/shared/cert-cases.mjs — the cert registry contract
 * (plan 51 P2-D). The most important cell is the ROT GUARD: every case's
 * revert anchor (`from`) must match exactly once in the CURRENT tree, so a
 * future edit that moves the fixed line cannot leave a silently-broken cert
 * case behind (update the case in the same change).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CERT_CASES } from "./cert-cases.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

describe("cert-cases registry — contract", () => {
  it("ids are unique and required fields are present", () => {
    const ids = new Set();
    for (const c of CERT_CASES) {
      expect(c.id).toMatch(/^[a-z0-9-]+$/);
      expect(ids.has(c.id), c.id).toBe(false);
      ids.add(c.id);
      expect(c.description, c.id).toBeTruthy();
      expect(c.provenance, c.id).toBeTruthy();
      expect(Array.isArray(c.revert) && c.revert.length > 0, c.id).toBe(true);
      expect(Array.isArray(c.steps) && c.steps.length > 0, c.id).toBe(true);
    }
  });

  it("every step declares a command and a plain-substring signature", () => {
    for (const c of CERT_CASES) {
      for (const s of c.steps) {
        expect(s.name, c.id).toMatch(/^[a-z0-9-]+$/);
        expect(typeof s.cmd === "string" && s.cmd.trim().length > 0, `${c.id}/${s.name}`).toBe(true);
        expect(typeof s.expect === "string" && s.expect.trim().length > 0, `${c.id}/${s.name}`).toBe(true);
      }
    }
  });

  it("ROT GUARD: every revert anchor matches exactly once in the current tree", () => {
    for (const c of CERT_CASES) {
      for (const rev of c.revert) {
        const src = readFileSync(join(REPO_ROOT, rev.file), "utf8");
        const count = src.split(rev.from).length - 1;
        expect(count, `${c.id}: anchor in ${rev.file} matched ${count} times`).toBe(1);
        expect(rev.from, c.id).not.toBe(rev.to);
      }
    }
  });
});
