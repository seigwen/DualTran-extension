import { describe, it, expect } from "vitest";
import {
  assertHostState,
  waitForHostState,
  readHostState,
} from "../browser-e2e/setup.mjs";

/**
 * Unit tests for the tri-state host assertion library (S4, issue #53).
 *
 * `assertHostState` / `waitForHostState` wrap `readHostState` (the S2
 * three-state classifier) with assertion + polling semantics. These tests
 * use a fake `page` whose `evaluate` is a canned stub — the classifier
 * body inside evaluate cannot run under vitest (no browser globals); its
 * real-browser behavior is covered by the S2 evidence + the migrated E2E
 * suite. What IS fully testable here: the assertion matrix, count
 * semantics, error shape, and wait control flow.
 *
 * The load-bearing case is `shell` vs `expected: "healthy"` — the unit
 * proof of the Scene 3 false-green that this issue eliminates.
 */

/** Canned page stub: evaluate returns a fixed classification object. */
function stubPage(classification) {
  return {
    evaluate: async () => classification,
    waitForTimeout: async () => {},
  };
}

const HEALTHY = { count: 1, state: "healthy", hasButtons: true, hostFound: true };
const SHELL = { count: 1, state: "shell", hasButtons: false, hostFound: true };
const ABSENT = { count: 0, state: "absent", hasButtons: false, hostFound: false };
const HEALTHY_NO_BUTTONS = { count: 1, state: "healthy", hasButtons: false, hostFound: true };

describe("assertHostState", () => {
  it("passes when state is healthy with buttons", async () => {
    const state = await assertHostState(stubPage(HEALTHY), "floating", "healthy");
    expect(state.state).toBe("healthy");
    expect(state.count).toBe(1);
  });

  it("FAILS when a shell host is asserted as healthy (Scene 3 false-green proof)", async () => {
    await expect(
      assertHostState(stubPage(SHELL), "singleton", "healthy")
    ).rejects.toThrow(/shell/);
  });

  it("FAILS when healthy host has no buttons inside the shadow root", async () => {
    await expect(
      assertHostState(stubPage(HEALTHY_NO_BUTTONS), "floating", "healthy")
    ).rejects.toThrow(/hasButtons/);
  });

  it("FAILS when host is absent but healthy was expected", async () => {
    await expect(
      assertHostState(stubPage(ABSENT), "floating", "healthy")
    ).rejects.toThrow(/absent/);
  });

  it("FAILS when count does not match opts.count", async () => {
    await expect(
      assertHostState(stubPage({ ...HEALTHY, count: 2 }), "floating", "healthy", { count: 1 })
    ).rejects.toThrow(/count/);
  });

  it("passes negative assertion: absent expected, absent found", async () => {
    const state = await assertHostState(stubPage(ABSENT), "singleton", "absent");
    expect(state.state).toBe("absent");
  });

  it("passes negative assertion: shell expected after injection, shell found", async () => {
    const state = await assertHostState(stubPage(SHELL), "floating", "shell");
    expect(state.state).toBe("shell");
  });

  it("FAILS negative assertion: absent expected, healthy found", async () => {
    await expect(
      assertHostState(stubPage(HEALTHY), "singleton", "absent")
    ).rejects.toThrow(/absent/);
  });

  it("passes 'any' regardless of state but still enforces opts.count", async () => {
    const s1 = await assertHostState(stubPage(SHELL), "floating", "any");
    expect(s1.state).toBe("shell");
    const s2 = await assertHostState(stubPage(ABSENT), "floating", "any");
    expect(s2.state).toBe("absent");
    await expect(
      assertHostState(stubPage(ABSENT), "floating", "any", { count: 1 })
    ).rejects.toThrow(/count/);
  });

  it("error message contains the full classification JSON and the label", async () => {
    const err = await assertHostState(stubPage(SHELL), "singleton", "healthy", {
      label: "Scene 3: singleton after nav",
    }).catch((e) => e);
    expect(err.message).toContain("Scene 3: singleton after nav");
    expect(err.message).toContain('"state":"shell"');
    expect(err.message).toContain('"count":1');
  });

  it("returns the classification object for downstream reuse", async () => {
    const state = await assertHostState(stubPage({ ...HEALTHY, count: 3 }), "floating", "healthy", {
      count: 3,
    });
    expect(state).toEqual({ count: 3, state: "healthy", hasButtons: true, hostFound: true });
  });
});

describe("waitForHostState", () => {
  it("resolves immediately when the first read already matches", async () => {
    let calls = 0;
    const page = {
      evaluate: async () => {
        calls += 1;
        return HEALTHY;
      },
      waitForTimeout: async () => {},
    };
    const state = await waitForHostState(page, "floating", "healthy", { timeoutMs: 1000 });
    expect(state.state).toBe("healthy");
    expect(calls).toBe(1);
  });

  it("polls until the expected state appears", async () => {
    let calls = 0;
    const page = {
      evaluate: async () => {
        calls += 1;
        return calls < 3 ? ABSENT : HEALTHY;
      },
      waitForTimeout: async () => {},
    };
    const state = await waitForHostState(page, "floating", "healthy", {
      timeoutMs: 1000,
      pollMs: 1,
    });
    expect(state.state).toBe("healthy");
    expect(calls).toBe(3);
  });

  it("throws on timeout with the last observed state in the message", async () => {
    const page = {
      evaluate: async () => SHELL,
      waitForTimeout: async () => {},
    };
    const err = await waitForHostState(page, "singleton", "healthy", {
      timeoutMs: 60,
      pollMs: 5,
      label: "wait singleton",
    }).catch((e) => e);
    expect(err.message).toContain("wait singleton");
    expect(err.message).toContain("timed out");
    expect(err.message).toContain('"state":"shell"');
  });

  it("honors timeoutMs with a real clock (does not poll forever)", async () => {
    let calls = 0;
    const page = {
      evaluate: async () => {
        calls += 1;
        return ABSENT;
      },
      waitForTimeout: async (ms) => new Promise((r) => setTimeout(r, ms)),
    };
    const start = Date.now();
    await expect(
      waitForHostState(page, "floating", "healthy", { timeoutMs: 50, pollMs: 10 })
    ).rejects.toThrow(/timed out/);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(2000);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("count semantics apply during polling (duplicate → count: 1 converges)", async () => {
    let calls = 0;
    const page = {
      evaluate: async () => {
        calls += 1;
        return calls < 3 ? { ...HEALTHY, count: 2 } : HEALTHY;
      },
      waitForTimeout: async () => {},
    };
    const state = await waitForHostState(page, "floating", "healthy", {
      timeoutMs: 1000,
      pollMs: 1,
      count: 1,
    });
    expect(state.count).toBe(1);
    expect(calls).toBe(3);
  });
});
