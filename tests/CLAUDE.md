# tests/CLAUDE.md

DualTran test directory. Uses **Vitest + jsdom** for unit/integration tests, **Playwright** for browser E2E tests, and **node tests/mcp-e2e/start-test-servers.js** for MCP E2E component-level quick verification.

---

## Running Tests

```bash
npm test                                        # run all vitest tests
npx vitest run tests/ai/                        # run a specific subdirectory
npx vitest run tests/ai/sseClient.test.js       # run a single file
npx vitest run --coverage                       # with coverage
npm run test:browser-e2e                        # browser E2E (aimock mock, port 8788)
npm run test:browser-e2e:aimock                 # same as above (backward-compatible alias)
```

---

## Directory Structure & Test Scope

```
tests/
├── ai/                  # AI-related modules: sseClient, mock server, provider registration/migration/adapter
├── background/          # Service Worker background logic (~75 test files, four-layer decomposition, see below)
├── contentScript/       # Content script UI: translation button states, SSE message parsing, page translator
├── options/             # Options page UI: AI model selection/refresh, provider sync/switch, dark mode
├── popup/               # Popup page: PDF detection, language switching, text translation
├── lib/                 # Core library: config, i18n, languages, platformInfo
├── services/            # Translation services: translation cache, Google Translate API
├── integration/         # Cross-module integration: config change flow, messaging, popup↔background, storage sync, translation pipeline
├── manifest/            # Static validation: manifest.json structure, build artifact integrity
├── static/              # Static validation: i18n completeness, package.json sanity
├── scripts/             # Script config tests: browser-e2e-config parsing
├── util/                # Utility functions: language detection, word count
├── mock-server/         # Mock LLM server (see mock-server/CLAUDE.md)
├── mcp-e2e/             # MCP E2E test helper scripts (see §MCP E2E below)
├── fixtures/            # Test data (see §Fixtures below)
└── shared/              # Shared test infrastructure (test-server-manager.mjs)
```

---

## Translation Test Rules

### 翻译不变量清单（每次翻译操作后必须断言）

1. **【元素数量不变量】** 每个内容块最多有 1 个翻译输出元素
   - newLine: `parent.querySelectorAll(':scope > translated').length <= 1`
   - replaceOriginal: `container.querySelectorAll('.dualtran-aitranslatedtext-replacemode').length <= 1`
   - **判定规则：断言翻译成功的测试必须同时断言此不变量。缺少此断言的测试不得合并。**

2. **【时间稳定不变量】** 翻译完成后等待 ≥ 3 秒，DOM 结构不应变化
   - Soak 测试捕获 serial feedback loop（`isDynamicTranslating` guard 无法防止的类型）
   - E2E: `assertNoDuplicateTranslationElements(page)` → `sleep(5000)` → 再次断言

3. **【副作用不变量】** 翻译操作不应修改未被翻译的节点
   - 记录翻译前的非翻译节点集合，翻译 + soak 后断言集合不变

4. **【Observer 不变量】** 翻译输出不应被 MutationObserver 当作新内容
   - jsdom: 模拟 observer 拾取 → 断言 `getNewNodes()` 不含 DualTran 生成元素
   - 使用 `_isDualTranGeneratedNode(node)` 进行判定

### 模式对称性规则

**任何翻译行为测试（jsdom 或 E2E）必须同时覆盖 newLine 和 replaceOriginal 两种模式。如果只测了一种模式，PR 不得合并。**

- 使用 `assertNoDuplicateTranslationElements(page)`（模式感知，自动选择正确的断言策略）
- 替代旧的 `assertNoDuplicateTranslations(page)`（仅检查 `<translated>` 元素，对 replaceOriginal 无效）
- E2E 矩阵测试：`observer-feedback-loop.mjs` 覆盖 {newLine, replaceOriginal} × {showOriginal=yes, no}

### 通用规则

1. **jsdom integration tests** — after calling `addTranslatedContent` or `translateResults`, assert element count invariant (#1).
2. **E2E tests** — call `assertNoDuplicateTranslationElements(page)` after every translation operation (Google, AI, dynamic content). This function is in `setup.mjs`.
3. **AI translation soak test** — after AI translation completes, wait 3 seconds and re-assert no duplicates (#2).
4. **Never use placeholder tests** like `expect(true).toBe(true)` for translation correctness. If the real test requires E2E, mark it with `it.todo("description")` instead.
5. **replaceOriginal mode** — AI text nodes are NOT inside `<translated>` elements. Use `assertReplaceOriginalNoDuplicates()` or `assertNoDuplicateTranslationElements()` (mode-aware) for assertions. The `_isDualTranGeneratedNode` hook verifies observer filter logic.

## Test Naming Conventions

### Unit Tests vs Integration Tests

| Suffix | Type | Characteristics |
|------|------|------|
| `*.test.js` | Unit test | Imports a **single** source module, tests its function input/output. Pure function tests typically use zero mocks. | |
| `*.integration.test.js` | Integration test | Imports **multiple** source modules, tests their **combined behavior** — whether the seams between modules are correct. | |
| `*.aimock.integration.test.js` | aimock integration test | Integration tests that require a real aimock HTTP server (`beforeAll`/`afterAll` manages lifecycle). | |

### background/ Four-Layer Decomposition Pattern

`tests/background/` uses four-layer naming for each functional domain (actionClick, autoTranslate, command, contextMenu, icon, install, etc.):

| Suffix | Source Module | Test Content | Mock Requirements |
|------|--------|----------|-----------|
| `*Helpers.test.js` | `xxxHelpers.js` | **Pure decision functions**: return message objects, status strings, or null. | None (pure functions) | |
| `*ExecutionHelpers.test.js` | `xxxExecutionHelpers.js` | **Effect builders**: convert decisions into typed effect descriptors `{ type, tabId, ... }`, executed via injected callbacks. | None or `vi.fn()` callbacks only | |
| `*Flow.integration.test.js` | Helpers + ExecutionHelpers | **Data flow verification**: whether Helper output correctly serves as ExecutionHelper input. | None (still data layer) | |
| `*DispatchLoop.integration.test.js` | Helpers + ExecutionHelpers + Executor | **Full dispatch loop**: creates real executor + `vi.fn()` side-effect handlers, verifies end-to-end call chain. | `vi.fn()` injection | |

This embodies the **functional core / imperative shell** architecture: decision logic (Helpers) are pure functions, side-effect execution (ExecutionHelpers) is isolated via dependency injection.

---

## Vitest Environment Configuration

Environment is specified per directory in `vitest.config.js` via `environmentMatchGlobs`:

| Directory | Environment | Reason |
|------|------|------|
| `tests/popup/**` | `jsdom` | Requires DOM API (document, window) |
| `tests/contentScript/**` | `jsdom` | Requires DOM API |
| `tests/options/**` | `jsdom` | Requires DOM API |
| All others | `node` | No DOM needed |

Coverage thresholds: lines 85%, functions 85%, branches 80%, statements 85%.

---

## Chrome API Mock Patterns

### Pattern A: Shared Factory (recommended for tests needing full chrome.*)

```js
import { createMockChrome } from "../fixtures/chrome/mockChrome.js";

beforeEach(() => { globalThis.chrome = createMockChrome(); });
afterEach(() => { delete globalThis.chrome; });
```

`createMockChrome()` provides full `chrome.storage` (local/sync/session areas + onChanged listener), `chrome.runtime` (sendMessage + onMessage._emit), `chrome.tabs`, `chrome.action`, `chrome.contextMenus`, `chrome.i18n`, `chrome.commands`.

Supports `overrides` parameter for deep-merge custom behavior:

```js
globalThis.chrome = createMockChrome({
  runtime: { id: "custom-id" },
  tabs: { query: vi.fn(() => Promise.resolve([])) },
});
```

### Pattern B: vi.stubGlobal (lightweight, stub only needed APIs)

```js
vi.stubGlobal('chrome', { runtime: { connect: vi.fn(() => mockPort) } });
afterEach(() => { vi.unstubAllGlobals(); });
```

Suitable for tests needing only a few Chrome APIs (e.g., sseClient only needs `runtime.connect`).

### Pattern C: vi.hoisted + vi.mock (heavy mocking)

```js
const mockState = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  storageMock: { get: vi.fn(), set: vi.fn() },
}));

vi.mock("../../src/lib/config.js", () => ({
  twpConfig: { get: (...args) => mockState.storageMock.get(...args) },
}));
```

`vi.hoisted` ensures mock state objects are created before `vi.mock` factory execution. Suitable for tests like translation services that need to mock multiple module dependencies.

---

## DOM Testing Pattern

Content script and options page tests use JSDOM to build standalone DOM:

```js
import { JSDOM } from "jsdom";

function createButton() {
  const dom = new JSDOM('<button class="dualtran-hide"><span>AI</span></button>');
  const btn = dom.window.document.querySelector("button");
  btn.btnAiTxtNode = btn.querySelector("span");
  return btn;
}

test("applyAiSuccessState should set success style", () => {
  const btn = createButton();
  applyAiSuccessState(btn);
  expect(btn.classList.contains("dualtran-ai-success")).toBe(true);
});
```

Each test file defines its own DOM factory function, avoiding shared global document state.

---

## Fixtures Directory

```
tests/fixtures/
├── chrome/
│   └── mockChrome.js          # Chrome API mock factory (see above)
├── dom/
│   ├── samplePage.html        # Sample HTML page for translation testing
│   └── translatedPage.html    # Translated HTML page (for comparison)
├── ai/
│   ├── openai-success.sse.txt # OpenAI SSE response sample (data: {choices:[...]} + [DONE])
│   └── gemini-success.json    # Gemini generateContent response sample
└── aimock/
    └── llm.json               # LLMock fixture data (see mock-server/CLAUDE.md §5)
```

### Fixture File Purposes

- **`mockChrome.js`** — Shared infrastructure for all tests needing `chrome.*` APIs. Each call returns a fresh instance, ensuring test isolation.
- **`dom/*.html`** — Used in content script tests to simulate real web page structures.
- **`ai/*.sse.txt / *.json`** — Static input data for AI response parsing tests.
- **`aimock/llm.json`** — Request matching rules and predefined responses for the aimock server (see `mock-server/CLAUDE.md`).

---

## Mock Server (tests/mock-server/)

`tests/mock-server/` contains LLM mock servers that can be programmatically started in tests.

| File | Port | Purpose |
|------|------|------|
| `mock-llm-server-aimock.js` | 8788 | Based on @copilotkit/aimock, supports 7 providers + scenario switching + fixture-driven |
| `mock-anthropic.js` | — | Koa, simulates Anthropic SSE (parses `<译泽>` tags) |
| `mock-gemini.js` | — | Koa, simulates Gemini API (parses `<译泽>` tags) |

Usage in vitest tests:

```js
import { startAimockLlmServer, stopAimockLlmServer } from "../mock-server/mock-llm-server-aimock.js";

let server;
beforeAll(async () => { server = await startAimockLlmServer(8788); });
afterAll(async () => { await stopAimockLlmServer(server); });
```

See `mock-server/CLAUDE.md` for detailed documentation.

---

## Browser E2E Tests

`tests/browser-e2e/` is a modular **Playwright** E2E suite (not vitest) that loads the built extension in real Chromium. Each scenario is an independent `.mjs` file, orchestrated by `run-all.mjs`.

### How to Run

```bash
npm run test:e2e:all                          # run all scenarios
npm run test:e2e:translation                  # translation scenario only
npm run test:e2e:popup                        # popup page scenario only
npm run test:e2e:settings-translation         # language + translation + AI provider settings scenario only
npm run test:e2e:settings-appearance          # appearance settings scenario only
npm run test:e2e:settings-advanced            # advanced settings scenario only
npm run test:e2e:error-edge                   # error recovery scenario only
npm run test:e2e:install                      # first-run scenario only
node tests/browser-e2e/run-all.mjs --scenario=popup-behavior    # popup page behavior verification
node tests/browser-e2e/run-all.mjs --scenario=options-behavior  # options page behavior verification
npm run test:browser-e2e:aimock               # backward compatible (re-exports run-all.mjs)
node tests/browser-e2e/run-all.mjs --scenario=popup   # run a single scenario directly
node tests/browser-e2e/run-all.mjs --scenario=settings --grep=translation  # filter by name
```

### Prerequisites

1. Must run `npm run build` first (Playwright loads `dist/chrome/`)
2. Scenarios needing mock servers (`needsMock: true`) auto-start aimock subprocess; others use `setupBasic()` to skip mock

### Directory Structure

```
tests/browser-e2e/
├── setup.mjs                         # Shared harness: two-layer startup (setupBasic/setupFull) + ErrorCollector + utility functions
├── run-all.mjs                       # Scenario orchestrator: --scenario / --grep filtering, fault-tolerant (setupFull failure still runs basic scenarios)
├── translation.mjs                   # Translation features (13 steps, migrated from browser-e2e.mjs)
├── install-firstrun.mjs              # Installation & first-run verification (4 steps)
├── settings-translation.mjs          # Language + translation + AI provider settings (10 steps)
├── settings-appearance.mjs           # Appearance settings (5 steps)
├── settings-advanced.mjs             # Advanced settings: keyboard shortcuts + storage + other (6 steps)
├── popup-controls.mjs                # Popup page interactive controls (6 steps, 11 controls)
├── popup-behavior.mjs                # Popup page behavior verification (4 steps: translateSelected button, hover translation, language detection, etc.)
├── options-behavior.mjs              # Options page behavior verification (9 steps: translateSelected, hover original text, link translation, pre tags, Ctrl×2 shortcuts, etc.)
└── error-edge.mjs                    # Error recovery & edge cases (6 steps)
```

`launchExtensionBrowser()` injects a monkey patch via `addInitScript` to force all pages' `attachShadow({ mode: "closed" })` to `mode: "open"`, ensuring Playwright's `evaluate()` can penetrate all shadow DOMs for behavior verification.

### Module Contract

Each scenario file exports:

```js
export const name = "settings-appearance";   // scenario name
export const needsMock = false;             // true → setupFull(), false → setupBasic()
export const smoke = true;                  // true → included in --smoke quick regression subset
export async function run(scope) {           // scope contains context/page/extensionId/serviceWorker/testPageUrl/verifyPageUrl/longPageUrl/dynamicContentPageUrl/frPageUrl/linkSourceUrl/linkTargetUrl/collector/mockServerConfig
  // scenario logic
}
```

### Smoke Quick Regression Subset

`--smoke` flag only runs scenarios marked `smoke = true` (no Mock server needed, few steps, pure UI interaction), suitable for CI quick gates:

```bash
npm run test:e2e:smoke   # completes in 3-5 minutes, about 6 scenarios
```

Smoke scenario selection criteria: `needsMock: false` + validates core paths + few steps. Current smoke scenarios:

| Scenario | Steps | Description |
|------|--------|------|
| install-firstrun | 4 | Basic installation flow |
| settings-appearance | 5 | Dark mode + colors + popup styles |
| settings-advanced | 6 | Keyboard shortcuts + storage + other |
| popup-controls | 6 | Popup page 11 controls |
| popup-behavior | 4 | Popup page behavior verification |
| options-behavior | 9 | Options page behavior verification |

### Mock Mode Configuration

`tests/browser-e2e/browser-e2e-config.mjs` always uses aimock server:

| Mode | Port | Expected AI Response Fragment | Mock Server Script |
|------|------|-----------------|----------------|
| `aimock` | 8788 | `"🌐[aimock]"` | `mock-llm-server-aimock.js` |

### ErrorCollector

Shared error collector (`scope.collector`), API:
- `collector.record(source, text, url)` — record error
- `collector.attachPage(page, label)` — attach page console/exception listener
- `collector.attachServiceWorker(sw)` — attach SW console listener
- `collector.collectExtensionErrors(page, extId)` — check chrome://extensions
- `collector.printSummary()` — print actionable/benign/fatal classified summary

---

## MCP E2E Debug Helper (tests/mcp-e2e/)

> ⚠️ **MCP E2E is a development-time debug helper tool, not a CI gate.**
> CI quick regression: `npm run test:e2e:smoke` (3-5 minutes)
> Full regression: `npm run test:e2e:all`

`tests/mcp-e2e/` contains E2E component tests that run directly in Claude Code via Chrome DevTools MCP.

### Why add MCP E2E when Playwright E2E already exists?

Playwright E2E (`browser-e2e/` modular suite) is a complete end-to-end regression test suite, suitable for CI/CD and pre-release verification. But it has two inconveniences in daily development:

1. **Cannot run directly in Claude Code conversation** — Playwright is an independent Node.js script requiring separate terminal execution of `npm run test:browser-e2e:aimock`; Claude Code cannot observe intermediate states or dynamically adjust tests
2. **Running the full 13 steps takes a long time each time** — after changing an AI translation-related function, you just want to quickly verify Mock server response correctness, without running Google translation, dark mode, options page persistence and other irrelevant steps

MCP E2E solves both problems: type `/run-e2e-mcp` in Claude Code, and Claude Code directly controls Chrome via MCP tools (loading extension, navigating pages, executing JS, verifying results). Developers can see each component's test results in real time and can run just one test. Feedback in seconds after code changes, without leaving Claude Code.

**The three are complementary, not replacements**:
- **Playwright E2E (full)**: complete pipeline regression (content script → port → SW → API → DOM), must run before release. Command: `npm run test:e2e:all`
- **Playwright E2E (Smoke)**: quick regression subset (3-5 minutes), suitable for CI gates. Command: `npm run test:e2e:smoke`
- **MCP E2E**: development-time debug helper, component-level quick verification, not included in CI. Type `/run-e2e-mcp` in Claude Code

### Differences from Playwright E2E

| | Playwright (`browser-e2e/`) | MCP (`mcp-e2e/`) |
|---|---|---|
| **Execution** | `npm run test:browser-e2e:aimock` | `/run-e2e-mcp` in Claude Code |
| **Test engine** | Playwright + Node.js scripts | Chrome DevTools MCP tool calls |
| **Browser management** | Playwright auto-starts Chromium | MCP auto-starts system Chrome |
| **Extension loading** | `--load-extension` CLI flag | MCP `install_extension` tool |
| **Test scope** | Full pipeline (Content Script → port → SW → API → DOM) | Component-level independent verification (Google Translate, button UI, SW→Mock, multi-provider, config) |
| **AI translation verification** | Full end-to-end: auto-improvement → per-node `🌐[aimock]` check | SW directly fetches Mock server to verify response |
| **Suitable scenarios** | CI/CD, pre-release full regression | Development-time quick verification, headless environment debugging |
| **Display required** | Yes (`headless: false`, Chrome extension limitation) | Yes (MCP-launched Chrome also needs display) |
| **Known limitations** | None | `chrome.runtime.connect` port messages don't work under CDP control |

### Test Checklist (9 tests)

| Test | Verification |
|------|----------|
| Test A | Google Translate: trigger translation → `<translated>` node appears |
| Test B | Button UI: inline button group + AI button exists and visible |
| Test C | SW→Mock direct: SW fetch Mock server → `🌐[aimock]` response correct |
| Test D | Multi-provider: OpenRouter + Anthropic + Gemini + wildcard routing + 401 error scenarios |
| Test E | Extension config: `chrome.storage.local` read/write + nested objects + recovery |
| Test F | Provider dropdown: `#aiProvider` ≥ 5 options including OpenAI/Anthropic/Gemini |
| Test G | Generic panel fields: switch provider → `#genericApiKeyLabel` and other labels update |
| Test I | Model selection loading state: `#genericModel` from disabled to enabled and populated |
| Test J | Popup page language→storage round-trip: change language → read `chrome.storage.local` |

> **Note**: Test H (API Key password field visibility toggle) has been removed — this feature is not yet implemented (`apiKeyGeneric` is a plain text input, no `type="password"` and no toggle button).

### File Structure

```
tests/mcp-e2e/
└── start-test-servers.js   # Start mock LLM (port 8788) + static test page server (random port)
.claude/skills/
└── run-e2e-mcp.md          # MCP E2E test instructions (9 tests, A-G + I-J)
```

### How to Run

Type `/run-e2e-mcp` in Claude Code to automatically execute 9 component tests:

| Test | Verification |
|------|----------|
| Test A | Google Translate: trigger translation → `<translated>` node appears |
| Test B | Button UI: inline button group + AI button exists and visible |
| Test C | SW→Mock direct: SW fetch Mock server → `🌐[aimock]` response correct |
| Test D | Multi-provider: OpenRouter + Anthropic + Gemini + wildcard routing + 401 error scenarios |
| Test E | Extension config: `chrome.storage.local` read/write + nested objects + recovery |
| Test F | Provider dropdown: `#aiProvider` ≥ 5 options including OpenAI/Anthropic/Gemini |
| Test G | Generic panel fields: switch provider → `#genericApiKeyLabel` and other labels update |
| Test I | Model selection loading state: `#genericModel` from disabled to enabled and populated |
| Test J | Popup page language→storage round-trip: change language → read `chrome.storage.local` |

### MCP Configuration

Configure `chrome-devtools-mcp` in `.mcp.json` (official Google Chrome DevTools MCP v1.3.0) and enable `--category-extensions`. Skill definition is in `.claude/skills/run-e2e-mcp.md`.

---

## Conventions for Writing New Tests

### 1. File Location

Test files are placed in subdirectories corresponding to `src/`:

```
src/contentScript/aiUiState.js   →  tests/contentScript/aiUiState.test.js
src/lib/ai/providerRegistry.js   →  tests/ai/providerRegistry.test.js
src/background/actionClick*.js   →  tests/background/actionClick*.test.js
```

### 2. Pure Functions First

If the module under test is a pure function (no side effects, no Chrome API dependency), directly import and assert return values, **no mocks needed**:

```js
import { resolveDesktopToggleTranslationMessage } from "../../src/background/actionClickHelpers.js";

test("should return translateThisPage when tab is not translated", () => {
  const msg = resolveDesktopToggleTranslationMessage({
    pageIsTranslated: false,
    targetLang: "zh",
  });
  expect(msg).toBe("translateThisPage");
});
```

### 3. Use Shared Factory for Mock Chrome API

Don't hand-write chrome mock. Use `createMockChrome()`:

```js
import { createMockChrome } from "../fixtures/chrome/mockChrome.js";

beforeEach(() => { globalThis.chrome = createMockChrome(); });
afterEach(() => { delete globalThis.chrome; });
```

### 4. Integration Test Naming

Cross-module test filenames must include `.integration.`:

```
goodName.integration.test.js   ✓
goodName.test.js               ✓ (unit test)
goodName.spec.js               ✗ (vitest does not include .spec)
```

### 5. Tests Needing Real HTTP

Use `beforeAll`/`afterAll` to manage server lifecycle, don't start/stop in each test:

```js
let server;
beforeAll(async () => { server = await startAimockLlmServer(0); }); // port 0 = random port
afterAll(async () => { await stopAimockLlmServer(server); });
```

### 6. Local Factory for DOM Tests

Each test file defines its own DOM factory function, don't share global document:

```js
function createDom() {
  return new JSDOM('<div id="genericAiSettings"><input id="genericApiKey"></div>');
}
```

### 7. Vitest Configuration Enabled

- `globals: true` — `describe`/`test`/`expect`/`vi` etc. don't need import
- `restoreMocks: true` — automatically restores all mocks after each test
