/**
 * Unit tests for the visual capture helpers (V1, issue #67).
 *
 * `screenshotCheckpoint(page, id, opts)` — capture one checkpoint shot
 * into /tmp/e2e-shots/<scenario>/<id>.png, returning metadata; it must
 * be BEST-EFFORT (a screenshot failure must never mask the original
 * scenario error it is called from).
 *
 * `waitForVisualStability(page, opts)` — wait until two consecutive
 * animation frames report an unchanged signature, with a hard timeout
 * fallback (animations with 400ms transitions must settle; a runaway
 * animation must not hang the suite).
 *
 * The fake `page` cannot render — these tests lock the contract shape
 * (paths, metadata, best-effort semantics, polling control flow); the
 * real pixels are covered by the visual-audit E2E scenario.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  screenshotCheckpoint,
  waitForVisualStability,
  captureFailureShot,
} from "../browser-e2e/setup.mjs";

let shotsRoot;

beforeEach(() => {
  shotsRoot = mkdtempSync(join(tmpdir(), "e2e-shots-"));
});

afterEach(() => {
  rmSync(shotsRoot, { recursive: true, force: true });
});

/** Page stub whose screenshot() writes a marker file at the target path. */
function writingPage() {
  return {
    screenshot: async ({ path }) => {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, "PNG-MARKER");
      return Buffer.from("PNG-MARKER");
    },
    waitForTimeout: async () => {},
    evaluate: async () => 1,
  };
}

describe("screenshotCheckpoint", () => {
  it("captures into <root>/<scenario>/<id>.png and returns metadata", async () => {
    const meta = await screenshotCheckpoint(writingPage(), "after-google", {
      scenario: "visual-audit",
      root: shotsRoot,
    });
    expect(meta).not.toBeNull();
    expect(meta.id).toBe("after-google");
    expect(meta.scenario).toBe("visual-audit");
    expect(meta.path).toBe(join(shotsRoot, "visual-audit", "after-google.png"));
    expect(existsSync(meta.path)).toBe(true);
    expect(readFileSync(meta.path, "utf8")).toBe("PNG-MARKER");
  });

  it("creates nested scenario directories on demand", async () => {
    const meta = await screenshotCheckpoint(writingPage(), "popup-default", {
      scenario: "visual-audit/nested",
      root: shotsRoot,
    });
    expect(existsSync(meta.path)).toBe(true);
  });

  it("returns null (never throws) when the screenshot itself fails — best-effort contract", async () => {
    const failingPage = {
      screenshot: async () => {
        throw new Error("renderer crashed");
      },
    };
    const meta = await screenshotCheckpoint(failingPage, "failure-scenario", {
      scenario: "translation",
      root: shotsRoot,
    });
    expect(meta).toBeNull();
  });

  it("sanitizes ids so a weird id cannot escape the shots root", async () => {
    const meta = await screenshotCheckpoint(writingPage(), "../../etc/passwd", {
      scenario: "visual-audit",
      root: shotsRoot,
    });
    expect(meta).not.toBeNull();
    expect(meta.path.startsWith(shotsRoot)).toBe(true);
    expect(meta.path).not.toContain("..");
  });
});

describe("captureFailureShot", () => {
  it("captures into failures/failure-<scenario>.png on a failure path", async () => {
    process.env.E2E_SHOTS_DIR = shotsRoot;
    try {
      const scope = { page: writingPage() };
      await captureFailureShot(scope, "some-scenario");
      expect(existsSync(join(shotsRoot, "failures", "failure-some-scenario.png"))).toBe(true);
    } finally {
      delete process.env.E2E_SHOTS_DIR;
    }
  });

  it("never throws when the page is already closed (original error preserved)", async () => {
    const scope = { page: { isClosed: () => true } };
    await expect(captureFailureShot(scope, "dead-page")).resolves.toBeUndefined();
  });

  it("never throws when the screenshot itself fails", async () => {
    const scope = {
      page: {
        isClosed: () => false,
        screenshot: async () => {
          throw new Error("renderer gone");
        },
      },
    };
    await expect(captureFailureShot(scope, "broken")).resolves.toBeUndefined();
  });

  it("respects a custom shots root via E2E_SHOTS_DIR (scope without page is a no-op)", async () => {
    process.env.E2E_SHOTS_DIR = shotsRoot;
    try {
      await expect(captureFailureShot({}, "no-page")).resolves.toBeUndefined();
    } finally {
      delete process.env.E2E_SHOTS_DIR;
    }
  });
});

describe("waitForVisualStability", () => {
  it("resolves once two consecutive frames report an identical signature", async () => {
    let calls = 0;
    const page = {
      // Signature changes for the first two frames, then stabilizes.
      evaluate: async () => {
        calls++;
        return calls < 3 ? calls : 3;
      },
      waitForTimeout: async () => {},
    };
    const result = await waitForVisualStability(page, { timeoutMs: 5000, settleFrames: 2 });
    expect(result.stable).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it("returns stable:false at the timeout when the signature never settles", async () => {
    let calls = 0;
    const page = {
      evaluate: async () => {
        calls++;
        return Date.now() + calls;
      },
      waitForTimeout: async () => {},
    };
    const result = await waitForVisualStability(page, { timeoutMs: 300, settleFrames: 2 });
    expect(result.stable).toBe(false);
  });

  it("degrades gracefully when evaluate throws (page navigating)", async () => {
    let calls = 0;
    const page = {
      evaluate: async () => {
        calls++;
        if (calls < 4) throw new Error("Execution context was destroyed");
        return 42;
      },
      waitForTimeout: async () => {},
    };
    const result = await waitForVisualStability(page, { timeoutMs: 5000, settleFrames: 2 });
    expect(result.stable).toBe(true);
  });
});
