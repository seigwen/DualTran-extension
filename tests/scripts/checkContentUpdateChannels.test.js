/**
 * Tests for scripts/check-content-update-channels.js
 *
 * The lint is the enforcement arm of the content-update channel SSOT
 * (tests/shared/content-update-channels.mjs). Its job: make it impossible for
 * a channel to exist without a mock-page declaration, a behavioral E2E run in
 * both display modes, and unit coverage — or an explicit, written exemption.
 *
 * Each rule gets a negative fixture (must fail) and, where the rule is about
 * coverage rather than syntax, a positive fixture (must pass), so the lint
 * itself cannot become one of the false greens it exists to prevent.
 *
 *   N1  active channel must be「✅ 已模拟」in a mock page
 *   N2  a declared channel id must exist in the SSOT (no ghost channels)
 *   N3  scenarioRefs must exist and carry behavioral iteration
 *   N4  unitRefs must exist (or unitRefsExempt with a reason)
 *   N5  provenance must be non-empty
 *   N6  exempt channels must record reason + upstream impact on both sides
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "..", "scripts", "check-content-update-channels.js");

let tmpDir;
let counter = 0;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "content-update-channels-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Build an isolated fixture root with the four artefacts and run the lint.
 *
 * @param {{ channels: string, mockPage?: string, scenarios?: Object<string,string>, units?: string[] }} spec
 */
function runCheck(spec) {
  const root = join(tmpDir, `case-${counter++}`);
  const ssotDir = join(root, "tests", "shared");
  const e2eDir = join(root, "tests", "browser-e2e");
  const unitDir = join(root, "tests", "contentScript");
  const pageDir = join(root, "extra", "e2e");
  mkdirSync(ssotDir, { recursive: true });
  mkdirSync(e2eDir, { recursive: true });
  mkdirSync(unitDir, { recursive: true });
  mkdirSync(pageDir, { recursive: true });

  writeFileSync(join(ssotDir, "content-update-channels.mjs"), spec.channels);

  if (spec.mockPage !== undefined) {
    writeFileSync(join(pageDir, "test-page.html"), spec.mockPage);
  }
  for (const [name, content] of Object.entries(spec.scenarios || {})) {
    writeFileSync(join(e2eDir, name), content);
  }
  for (const unit of spec.units || []) {
    writeFileSync(join(unitDir, unit), "// unit fixture\n");
  }

  try {
    const out = execFileSync("node", [SCRIPT, "--root", root], { encoding: "utf8" });
    return { exitCode: 0, out };
  } catch (e) {
    return {
      exitCode: e.status ?? 1,
      out: (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? ""),
    };
  }
}

/** A minimal valid mock page carrying the channel section. */
const goodMockPage = `<!DOCTYPE html><html><head>
<!-- MOCK FIDELITY
  分支：内容更新通道（SSOT）
  - \`c1\`（fixture channel）：✅ 已模拟
  分支：时序
  - 同步响应：✅ 已模拟
  - 网络延迟：⛔ 未模拟（豁免理由：本地即时；上游影响：无）
-->
</head><body></body></html>`;

const goodScenario = `
const { forEachDisplayMode } = await import("./setup.mjs");
export async function run(scope) {
  await forEachDisplayMode(scope, async (mode) => { await scope.page.goto("about:blank?m=" + mode); });
}
`;

/** A single active channel referencing c1 / scenario / unit properly. */
const goodChannels = `
export const CONTENT_UPDATE_CHANNELS = [
  {
    id: "c1",
    mechanism: "fixture",
    provenance: "#1 (2026-01-01 fixture)",
    status: "active",
    kind: "text",
    simulator: { page: "test-page.html", section: "#s", trigger: "#b" },
    scenarioRefs: ["fixture-scenario.mjs"],
    unitRefs: ["fixture.test.js"],
    canary: { status: "not-covered", reason: "fixture" },
  },
];
export const ACTIVE_CHANNELS = CONTENT_UPDATE_CHANNELS.filter((c) => c.status === "active");
`;

describe("check-content-update-channels", () => {
  it("passes a fully-wired active channel", () => {
    const { exitCode } = runCheck({
      channels: goodChannels,
      mockPage: goodMockPage,
      scenarios: { "fixture-scenario.mjs": goodScenario },
      units: ["fixture.test.js"],
    });
    expect(exitCode).toBe(0);
  });

  it("N1: fails an active channel with no mock-page declaration", () => {
    const { exitCode, out } = runCheck({
      channels: goodChannels,
      mockPage: `<!DOCTYPE html><html><head>
<!-- MOCK FIDELITY
  分支：时序
  - 网络延迟：⛔ 未模拟（豁免理由：本地；上游影响：无）
-->
</head><body></body></html>`,
      scenarios: { "fixture-scenario.mjs": goodScenario },
      units: ["fixture.test.js"],
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("N1");
  });

  it("N1: fails an active channel declared「⛔ 未模拟」", () => {
    const { exitCode, out } = runCheck({
      channels: goodChannels,
      mockPage: `<!DOCTYPE html><html><head>
<!-- MOCK FIDELITY
  分支：内容更新通道（SSOT）
  - \`c1\`（fixture）：⛔ 未模拟（豁免理由：fixture；上游影响：无）
  分支：时序
  - 网络延迟：⛔ 未模拟（豁免理由：本地；上游影响：无）
-->
</head><body></body></html>`,
      scenarios: { "fixture-scenario.mjs": goodScenario },
      units: ["fixture.test.js"],
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("N1");
  });

  it("N2: fails a ghost channel id in the mock page", () => {
    const { exitCode, out } = runCheck({
      channels: goodChannels,
      mockPage: `<!DOCTYPE html><html><head>
<!-- MOCK FIDELITY
  分支：内容更新通道（SSOT）
  - \`c1\`（fixture）：✅ 已模拟
  - \`ghost-channel\`（not in SSOT）：✅ 已模拟
  分支：时序
  - 网络延迟：⛔ 未模拟（豁免理由：本地；上游影响：无）
-->
</head><body></body></html>`,
      scenarios: { "fixture-scenario.mjs": goodScenario },
      units: ["fixture.test.js"],
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("ghost-channel");
    expect(out).toContain("N2");
  });

  it("N3: fails when the scenario has no behavioral mode iteration", () => {
    const { exitCode, out } = runCheck({
      channels: goodChannels,
      mockPage: goodMockPage,
      scenarios: {
        "fixture-scenario.mjs": `
export async function run(scope) {
  // Mentioning newLine and replaceOriginal in a comment must not count.
  await scope.page.goto("about:blank");
}
`,
      },
      units: ["fixture.test.js"],
    });
    expect(exitCode).toBe(1);
    expect(out.toLowerCase()).toContain("behavioral mode iteration");
  });

  it("N3: fails when a scenarioRef does not exist", () => {
    const { exitCode, out } = runCheck({
      channels: goodChannels,
      mockPage: goodMockPage,
      scenarios: {},
      units: ["fixture.test.js"],
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("does not exist");
  });

  it("N4: fails when a unitRef does not exist", () => {
    const { exitCode, out } = runCheck({
      channels: goodChannels,
      mockPage: goodMockPage,
      scenarios: { "fixture-scenario.mjs": goodScenario },
      units: [],
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("unit test");
  });

  it("N4: passes when unit coverage is explicitly exempted with a reason", () => {
    const { exitCode } = runCheck({
      channels: `
export const CONTENT_UPDATE_CHANNELS = [
  {
    id: "c1",
    mechanism: "fixture",
    provenance: "#1 (2026-01-01)",
    status: "active",
    kind: "text",
    simulator: { page: "test-page.html", section: "#s", trigger: "#b" },
    scenarioRefs: ["fixture-scenario.mjs"],
    unitRefs: [],
    unitRefsExempt: { reason: "requires a real browser engine (layout-driven)" },
    canary: { status: "not-covered", reason: "fixture" },
  },
];
`,
      mockPage: goodMockPage,
      scenarios: { "fixture-scenario.mjs": goodScenario },
      units: [],
    });
    expect(exitCode).toBe(0);
  });

  it("N5: fails a channel without provenance", () => {
    const { exitCode, out } = runCheck({
      channels: `
export const CONTENT_UPDATE_CHANNELS = [
  {
    id: "c1",
    mechanism: "fixture",
    provenance: "",
    status: "active",
    kind: "text",
    simulator: { page: "test-page.html", section: "#s", trigger: "#b" },
    scenarioRefs: ["fixture-scenario.mjs"],
    unitRefs: ["fixture.test.js"],
  },
];
`,
      mockPage: goodMockPage,
      scenarios: { "fixture-scenario.mjs": goodScenario },
      units: ["fixture.test.js"],
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("provenance");
  });

  it("N6: fails an exempt channel without reason + upstream impact", () => {
    const { exitCode, out } = runCheck({
      channels: `
export const CONTENT_UPDATE_CHANNELS = [
  {
    id: "c1",
    mechanism: "closed shadow root",
    provenance: "design audit 2026-01-01",
    status: "exempt",
    exemption: { reason: "", upstreamImpact: "" },
    scenarioRefs: [],
    unitRefs: [],
  },
];
`,
      mockPage: `<!DOCTYPE html><html><head>
<!-- MOCK FIDELITY
  分支：内容更新通道（SSOT）
  - \`c1\`（closed shadow root）：⛔ 未模拟（豁免理由：物理不可达；上游影响：无）
  分支：时序
  - 网络延迟：⛔ 未模拟（豁免理由：本地；上游影响：无）
-->
</head><body></body></html>`,
      scenarios: {},
      units: [],
    });
    expect(exitCode).toBe(1);
    expect(out).toContain("N6");
  });
});
