/**
 * Conformance matrix runner (plan 84, P1).
 *
 *   node tests/conformance/run.mjs --engine=all [--scenario=<id>] [--json]
 *
 * Every scenario runs against real browsers: Chromium via Playwright (dist/chrome) and
 * Firefox via Selenium + BiDi (dist/firefox, wrapped in a throwaway probe build so the
 * scenario's config can seed storage). Assertions are user-visible: translated text,
 * error text in the floating panel, request counts on the mock endpoint.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMockServer } from "./mock-llm.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

const ENGINES = {
  chromium: { module: "./runners/chromium.mjs", extensionDir: path.join(ROOT, "dist", "chrome") },
  firefox: { module: "./runners/firefox.mjs", extensionDir: path.join(ROOT, "dist", "firefox") },
};

function parseArgs(argv) {
  const args = { engine: "all", scenario: "", json: false };
  for (const arg of argv) {
    if (arg.startsWith("--engine=")) args.engine = arg.slice(9);
    else if (arg.startsWith("--scenario=")) args.scenario = arg.slice(11);
    else if (arg === "--json") args.json = true;
  }
  return args;
}

function startFixtureServer() {
  const html = fs.readFileSync(path.join(HERE, "fixtures", "article.html"), "utf8");
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/article.html`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

async function loadScenarios() {
  const dir = path.join(HERE, "scenarios");
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".mjs") && !name.startsWith("_"))
    .sort();
  const scenarios = [];
  for (const file of files) {
    const mod = await import(path.join(dir, file));
    if (mod.default) scenarios.push(mod.default);
  }
  return scenarios;
}

async function runOne({ scenario, engineName, fixture, artifactsRoot }) {
  const engine = ENGINES[engineName];
  if (!fs.existsSync(engine.extensionDir)) {
    return { scenario: scenario.id, engine: engineName, status: "skipped", reason: `missing ${engine.extensionDir}` };
  }

  const mockMode = scenario.needsMock;
  const mock = mockMode ? await startMockServer({ mode: mockMode }) : null;
  const env = { fixtureUrl: fixture.url, mock };
  const config = typeof scenario.config === "function" ? scenario.config(env) : scenario.config;

  const runner = await import(engine.module);
  const artifactsDir = path.join(artifactsRoot, engineName, scenario.id);
  const ctx = await runner.launch({ extensionDir: engine.extensionDir, artifactsDir, config });

  const checks = [];
  const assert = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) });
  const started = Date.now();
  let error = "";
  try {
    if (engineName === "chromium") await ctx.setConfig(config);
    await scenario.run(ctx, env, assert);
  } catch (e) {
    error = String((e && e.message) || e);
    assert("scenario completed", false, error);
    await ctx.screenshot("failure").catch(() => {});
  } finally {
    await ctx.close().catch(() => {});
    if (mock) await mock.close();
  }

  const ok = checks.length > 0 && checks.every((check) => check.ok) && !error;
  return {
    scenario: scenario.id,
    engine: engineName,
    status: ok ? "pass" : "fail",
    durationMs: Date.now() - started,
    checks,
    error: error || undefined,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const all = process.argv.includes("--all");
  const scenarios = (await loadScenarios())
    .filter((scenario) => !args.scenario || scenario.id === args.scenario)
    .filter((scenario) => all || !scenario.experimental);
  if (scenarios.length === 0) {
    console.error(`[conformance] no scenario matched "${args.scenario}"`);
    return 2;
  }

  const engines = args.engine === "all" ? Object.keys(ENGINES) : [args.engine];
  const fixture = await startFixtureServer();
  const artifactsRoot = path.join(ROOT, "..", "DualTran-manage", "visual-evidence", "conformance");
  fs.mkdirSync(artifactsRoot, { recursive: true });

  const results = [];
  try {
    for (const scenario of scenarios) {
      for (const engineName of engines) {
        if (scenario.engines && !scenario.engines.includes(engineName)) continue;
        process.stdout.write(`[conformance] ${scenario.id} @ ${engineName} ... `);
        let result = await runOne({ scenario, engineName, fixture, artifactsRoot });
        if (result.status === "fail") {
          // One retry: browser startup under Xvfb is the flakiest part of the run, and a
          // single hiccup should not turn the matrix red.
          result = await runOne({ scenario, engineName, fixture, artifactsRoot });
        }
        console.log(result.status.toUpperCase());
        for (const check of result.checks || []) {
          console.log(`    ${check.ok ? "ok  " : "FAIL"} ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
        }
        results.push(result);
      }
    }
  } finally {
    await fixture.close();
  }

  const report = {
    at: new Date().toISOString(),
    gitSha: process.env.GIT_SHA || "",
    engines,
    results,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.status === "pass").length,
      failed: results.filter((r) => r.status === "fail").length,
      skipped: results.filter((r) => r.status === "skipped").length,
    },
  };
  const reportPath = path.join(artifactsRoot, "report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    `[conformance] ${report.summary.passed}/${report.summary.total} passed` +
      (report.summary.skipped ? `, ${report.summary.skipped} skipped` : "") +
      ` — report: ${reportPath}`
  );
  if (args.json) console.log(JSON.stringify(report, null, 2));
  return report.summary.failed === 0 ? 0 : 1;
}

process.exit(await main());
