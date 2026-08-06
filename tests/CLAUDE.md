# tests/CLAUDE.md

DualTran test directory. Uses **Vitest + jsdom** for unit/integration tests, **Playwright** for browser E2E tests, and **node tests/mcp-e2e/start-test-servers.js** for MCP E2E component-level quick verification.

---

## 运行测试

```bash
npm test                                        # 运行全部 vitest 测试
npx vitest run tests/ai/                        # 运行某个子目录
npx vitest run tests/ai/sseClient.test.js       # 运行单个文件
npx vitest run --coverage                       # 带覆盖率
npm run test:browser-e2e                        # 浏览器 E2E（aimock mock，端口 8788）
npm run test:browser-e2e:aimock                 # 同上（向后兼容别名）
```

---

## 目录结构与测试范围

```
tests/
├── ai/                  # AI 相关模块：sseClient、mock 服务器、provider 注册/迁移/适配
├── background/          # Service Worker 后台逻辑（≈75 个测试文件，四层分解，见下文）
├── contentScript/       # 内容脚本 UI：翻译按钮状态、SSE 消息解析、页面翻译器
├── options/             # 选项页 UI：AI 模型选择/刷新、provider 同步/切换、暗黑模式
├── popup/               # 弹出页：PDF 检测、语言切换、文本翻译
├── lib/                 # 核心库：config、i18n、languages、platformInfo
├── services/            # 翻译服务：翻译缓存、Google Translate API
├── integration/         # 跨模块集成：config 变更流、消息传递、popup↔background、存储同步、翻译管线
├── manifest/            # 静态校验：manifest.json 结构、构建产物完整性
├── static/              # 静态校验：i18n 完整性、package.json 健全性
├── scripts/             # 脚本配置测试：browser-e2e-config 解析
├── util/                # 工具函数：语言检测、词数统计
├── mock-server/         # Mock LLM 服务器（详见 mock-server/CLAUDE.md）
├── mcp-e2e/             # MCP E2E 测试辅助脚本（详见下文 §MCP E2E）
├── fixtures/            # 测试数据（详见下文 §Fixtures）
└── shared/              # 共享测试基础设施（test-server-manager.mjs）
```

---

## 测试命名约定

### 单元测试 vs 集成测试

| 后缀 | 类型 | 特征 |
|------|------|------|
| `*.test.js` | 单元测试 | 导入**单个**源模块，测试其函数的输入/输出。纯函数测试通常零 mock。 |
| `*.integration.test.js` | 集成测试 | 导入**多个**源模块，测试它们的**组合行为**——模块间的接缝是否正确。 |
| `*.aimock.integration.test.js` | aimock 集成测试 | 需要启动真实 aimock HTTP 服务器的集成测试（`beforeAll`/`afterAll` 管理生命周期）。 |

### background/ 四层分解模式

`tests/background/` 对每个功能域（actionClick、autoTranslate、command、contextMenu、icon、install 等）按四层命名：

| 后缀 | 源模块 | 测试内容 | Mock 需求 |
|------|--------|----------|-----------|
| `*Helpers.test.js` | `xxxHelpers.js` | **纯决策函数**：返回消息对象、状态字符串或 null。 | 无（纯函数） |
| `*ExecutionHelpers.test.js` | `xxxExecutionHelpers.js` | **效果构建器**：将决策转为类型化效果描述符 `{ type, tabId, ... }`，通过注入回调执行。 | 无或仅 `vi.fn()` 回调 |
| `*Flow.integration.test.js` | Helpers + ExecutionHelpers | **数据流验证**：Helper 输出能否正确作为 ExecutionHelper 输入。 | 无（仍是数据层） |
| `*DispatchLoop.integration.test.js` | Helpers + ExecutionHelpers + Executor | **完整调度循环**：创建真实 executor + `vi.fn()` 副作用处理器，验证端到端调用链。 | `vi.fn()` 注入 |

这体现了 **functional core / imperative shell** 架构：决策逻辑（Helpers）是纯函数，副作用执行（ExecutionHelpers）通过依赖注入隔离。

---

## Vitest 环境配置

在 `vitest.config.js` 中通过 `environmentMatchGlobs` 按目录指定运行环境：

| 目录 | 环境 | 原因 |
|------|------|------|
| `tests/popup/**` | `jsdom` | 需要 DOM API（document、window） |
| `tests/contentScript/**` | `jsdom` | 需要 DOM API |
| `tests/options/**` | `jsdom` | 需要 DOM API |
| 其他所有 | `node` | 不需要 DOM |

覆盖率阈值：lines 85%, functions 85%, branches 80%, statements 85%。

---

## Chrome API Mock 模式

### 模式 A：共享工厂（推荐用于需要完整 chrome.* 的测试）

```js
import { createMockChrome } from "../fixtures/chrome/mockChrome.js";

beforeEach(() => { globalThis.chrome = createMockChrome(); });
afterEach(() => { delete globalThis.chrome; });
```

`createMockChrome()` 提供完整的 `chrome.storage`（含 local/sync/session 三个区域 + onChanged 监听）、`chrome.runtime`（sendMessage + onMessage._emit）、`chrome.tabs`、`chrome.action`、`chrome.contextMenus`、`chrome.i18n`、`chrome.commands`。

支持 `overrides` 参数深度合并自定义行为：

```js
globalThis.chrome = createMockChrome({
  runtime: { id: "custom-id" },
  tabs: { query: vi.fn(() => Promise.resolve([])) },
});
```

### 模式 B：vi.stubGlobal（轻量，仅 stub 需要的 API）

```js
vi.stubGlobal('chrome', { runtime: { connect: vi.fn(() => mockPort) } });
afterEach(() => { vi.unstubAllGlobals(); });
```

适用于只需少量 Chrome API 的测试（如 sseClient 只需 `runtime.connect`）。

### 模式 C：vi.hoisted + vi.mock（重度 mock）

```js
const mockState = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  storageMock: { get: vi.fn(), set: vi.fn() },
}));

vi.mock("../../src/lib/config.js", () => ({
  twpConfig: { get: (...args) => mockState.storageMock.get(...args) },
}));
```

`vi.hoisted` 确保 mock 状态对象在 `vi.mock` 工厂执行前创建。适用于翻译服务等需要 mock 多个模块依赖的测试。

---

## DOM 测试模式

内容脚本和选项页测试使用 JSDOM 构建独立 DOM：

```js
import { JSDOM } from "jsdom";

function createButton() {
  const dom = new JSDOM('<button class="dualtran-hide"><span>AI</span></button>');
  const btn = dom.window.document.querySelector("button");
  btn.btnAiTxtNode = btn.querySelector("span");
  return btn;
}

test("applyAiSuccessState 应设置成功样式", () => {
  const btn = createButton();
  applyAiSuccessState(btn);
  expect(btn.classList.contains("dualtran-ai-success")).toBe(true);
});
```

每个测试文件自带 DOM 工厂函数，避免共享全局 document 状态。

---

## Fixtures 目录

```
tests/fixtures/
├── chrome/
│   └── mockChrome.js          # Chrome API mock 工厂（详见上文）
├── dom/
│   ├── samplePage.html        # 翻译测试用的示例 HTML 页面
│   └── translatedPage.html    # 翻译后的 HTML 页面（对照用）
├── ai/
│   ├── openai-success.sse.txt # OpenAI SSE 响应样本（data: {choices:[...]} + [DONE]）
│   └── gemini-success.json    # Gemini generateContent 响应样本
└── aimock/
    └── llm.json               # LLMock fixture 数据（详见 mock-server/CLAUDE.md §5）
```

### fixture 文件用途

- **`mockChrome.js`** — 所有需要 `chrome.*` API 的测试的共享基础设施。每次调用返回全新实例，确保测试隔离。
- **`dom/*.html`** — 内容脚本测试中用于模拟真实网页结构。
- **`ai/*.sse.txt / *.json`** — AI 响应解析测试的静态输入数据。
- **`aimock/llm.json`** — aimock 服务器的请求匹配规则和预定义响应（详见 `mock-server/CLAUDE.md`）。

---

## Mock 服务器（tests/mock-server/）

`tests/mock-server/` 目录包含可在测试中程序化启动的 LLM mock 服务器。

| 文件 | 端口 | 用途 |
|------|------|------|
| `mock-llm-server-aimock.js` | 8788 | 基于 @copilotkit/aimock，支持 7 个提供商 + 场景切换 + fixture 驱动 |
| `mock-anthropic.js` | — | Koa，模拟 Anthropic SSE（解析 `<译泽>` 标签） |
| `mock-gemini.js` | — | Koa，模拟 Gemini API（解析 `<译泽>` 标签） |

在 vitest 测试中的用法：

```js
import { startAimockLlmServer, stopAimockLlmServer } from "../mock-server/mock-llm-server-aimock.js";

let server;
beforeAll(async () => { server = await startAimockLlmServer(8788); });
afterAll(async () => { await stopAimockLlmServer(server); });
```

详细文档见 `mock-server/CLAUDE.md`。

---

## 浏览器 E2E 测试

`tests/browser-e2e/` 是模块化的 **Playwright** E2E 套件（非 vitest），用真实 Chromium 加载构建后的扩展。每个场景是独立 `.mjs` 文件，通过 `run-all.mjs` 编排。

### 运行方式

```bash
npm run test:e2e:all                          # 运行所有场景
npm run test:e2e:translation                  # 仅翻译场景
npm run test:e2e:popup                        # 仅弹窗页面场景
npm run test:e2e:settings-translation         # 仅语言+翻译+AI提供商设置场景
npm run test:e2e:settings-appearance          # 仅样式设置场景
npm run test:e2e:settings-advanced            # 仅高级设置场景
npm run test:e2e:error-edge                   # 仅错误恢复场景
npm run test:e2e:install                      # 仅首次运行场景
node tests/browser-e2e/run-all.mjs --scenario=popup-behavior    # 弹窗页行为验证
node tests/browser-e2e/run-all.mjs --scenario=options-behavior  # 选项页行为验证
npm run test:browser-e2e:aimock               # 向后兼容（重导出 run-all.mjs）
node tests/browser-e2e/run-all.mjs --scenario=popup   # 直接运行单个场景
node tests/browser-e2e/run-all.mjs --scenario=settings --grep=translation  # 按名称筛选
```

### 前置条件

1. 必须先 `npm run build`（Playwright 加载 `dist/chrome/`）
2. 需要 mock 服务器的场景（`needsMock: true`）自动启动 aimock 子进程;不需要的场景使用 `setupBasic()` 跳过 mock

### 目录结构

```
tests/browser-e2e/
├── setup.mjs                         # 共享 harness：两层启动（setupBasic/setupFull）+ ErrorCollector + 工具函数
├── run-all.mjs                       # 场景编排器：--scenario / --grep 筛选，容错（setupFull 失败仍运行 basic 场景）
├── translation.mjs                   # 翻译功能（13 步，从 browser-e2e.mjs 迁移）
├── install-firstrun.mjs              # 安装 & 首次运行验证（4 步）
├── settings-translation.mjs          # 语言 + 翻译 + AI 提供商设置（10 步）
├── settings-appearance.mjs           # 样式设置（5 步）
├── settings-advanced.mjs             # 高级设置：快捷键 + 存储 + 其他（6 步）
├── popup-controls.mjs                # 弹窗页面交互控件（6 步，11 个控件）
├── popup-behavior.mjs                # 弹窗页行为验证（4 步：translateSelected 按钮、悬停翻译、语言检测等）
├── options-behavior.mjs              # 选项页行为验证（9 步：translateSelected、悬停原文、链接翻译、pre 标签、Ctrl×2 快捷键等）
└── error-edge.mjs                    # 错误恢复 & 边缘场景（6 步）
```

`launchExtensionBrowser()` 通过 `addInitScript` 注入猴子补丁，将所有页面的 `attachShadow({ mode: "closed" })` 强制改为 `mode: "open"`，确保 Playwright 的 `evaluate()` 可以穿透所有 shadow DOM 进行行为验证。

### 模块合约

每个场景文件导出：

```js
export const name = "settings-appearance";   // 场景名称
export const needsMock = false;             // true → setupFull(), false → setupBasic()
export const smoke = true;                  // true → 纳入 --smoke 快速回归子集
export async function run(scope) {           // scope 含 context/page/extensionId/serviceWorker/testPageUrl/verifyPageUrl/longPageUrl/dynamicContentPageUrl/frPageUrl/linkSourceUrl/linkTargetUrl/collector/mockServerConfig
  // 场景逻辑
}
```

### Smoke 快速回归子集

`--smoke` 参数仅运行标记为 `smoke = true` 的场景（不需要 Mock 服务器、步骤少、纯 UI 交互），适合 CI 快速门禁：

```bash
npm run test:e2e:smoke   # 3-5 分钟内完成，约 6 个场景
```

Smoke 场景选择标准：`needsMock: false` + 验证核心路径 + 步骤数少。当前 smoke 场景：

| 场景 | 步骤数 | 说明 |
|------|--------|------|
| install-firstrun | 4 | 安装基本流程 |
| settings-appearance | 5 | 暗黑模式 + 颜色 + 弹出页样式 |
| settings-advanced | 6 | 快捷键 + 存储 + 其他 |
| popup-controls | 6 | 弹窗页 11 个控件 |
| popup-behavior | 4 | 弹窗页行为验证 |
| options-behavior | 9 | 选项页行为验证 |

### Mock 模式配置

`tests/browser-e2e/browser-e2e-config.mjs` 始终使用 aimock 服务器：

| 模式 | 端口 | 预期 AI 响应片段 | Mock 服务器脚本 |
|------|------|-----------------|----------------|
| `aimock` | 8788 | `"🌐[aimock]"` | `mock-llm-server-aimock.js` |

### ErrorCollector

共享错误收集器（`scope.collector`），API：
- `collector.record(source, text, url)` — 记录错误
- `collector.attachPage(page, label)` — 绑定页面 console/异常监听
- `collector.attachServiceWorker(sw)` — 绑定 SW console 监听
- `collector.collectExtensionErrors(page, extId)` — 检查 chrome://extensions
- `collector.printSummary()` — 打印 actionable/benign/fatal 分类汇总

---

## MCP E2E 调试辅助（tests/mcp-e2e/）

> ⚠️ **MCP E2E 是开发时调试辅助工具，非 CI 门禁。**
> CI 快速回归：`npm run test:e2e:smoke`（3-5 分钟）
> 完整回归：`npm run test:e2e:all`

`tests/mcp-e2e/` 包含通过 Chrome DevTools MCP 在 Claude Code 中直接运行的 E2E 组件测试。

### 为什么在已有 Playwright E2E 的情况下添加 MCP E2E？

Playwright E2E（`browser-e2e/` 模块化套件）是完整的端到端回归测试，适合 CI/CD 和发版前验证。但在日常开发中有两个不便：

1. **无法在 Claude Code 对话中直接运行**——Playwright 是独立 Node.js 脚本，需要在终端单独执行 `npm run test:browser-e2e:aimock`，Claude Code 无法观察中间状态或动态调整测试
2. **每次运行完整 13 步耗时较长**——改了一个 AI 翻译相关的函数，只想快速验证 Mock 服务器响应是否正确，不需要跑 Google 翻译、暗黑模式、选项页持久化等无关步骤

MCP E2E 解决这两个问题：在 Claude Code 中输入 `/run-e2e-mcp`，Claude Code 通过 MCP 工具直接操控 Chrome（加载扩展、导航页面、执行 JS、验证结果），开发者可以实时看到每个组件的测试结果，也可以只运行其中一个测试。修改代码后秒级反馈，不离开 Claude Code。

**三者是互补关系，不是替代**：
- **Playwright E2E（完整）**：完整管线回归（content script → port → SW → API → DOM），发版前必跑。命令：`npm run test:e2e:all`
- **Playwright E2E（Smoke）**：快速回归子集（3-5 分钟），适合 CI 门禁。命令：`npm run test:e2e:smoke`
- **MCP E2E**：开发时调试辅助，组件级快速验证，不纳入 CI。在 Claude Code 中输入 `/run-e2e-mcp`

### 与 Playwright E2E 的区别

| | Playwright (`browser-e2e/`) | MCP (`mcp-e2e/`) |
|---|---|---|
| **运行方式** | `npm run test:browser-e2e:aimock` | Claude Code 中 `/run-e2e-mcp` |
| **测试引擎** | Playwright + Node.js 脚本 | Chrome DevTools MCP 工具调用 |
| **浏览器管理** | Playwright 自启 Chromium | MCP 自启系统 Chrome |
| **扩展加载** | `--load-extension` 命令行标志 | MCP `install_extension` 工具 |
| **测试范围** | 完整管线（Content Script → port → SW → API → DOM） | 组件级独立验证（Google翻译、按钮UI、SW→Mock、多提供商、配置） |
| **AI 翻译验证** | 完整端到端：自动改进→逐节点 `🌐[aimock]` 检查 | SW 直接 fetch Mock 服务器验证响应 |
| **适用场景** | CI/CD、发版前完整回归 | 开发时快速验证、无显示器环境调试 |
| **需要显示器** | 是（`headless: false`，Chrome 扩展限制） | 是（MCP 启动的 Chrome 也需要显示） |
| **已知限制** | 无 | `chrome.runtime.connect` 端口消息在 CDP 控制下不工作 |

### 测试清单（9 个）

| 测试 | 验证内容 |
|------|----------|
| Test A | Google 翻译：触发翻译 → `<translated>` 节点出现 |
| Test B | 按钮 UI：内联按钮组 + AI 按钮存在且可见 |
| Test C | SW→Mock 直连：SW fetch Mock 服务器 → `🌐[aimock]` 响应正确 |
| Test D | 多提供商：OpenRouter + Anthropic + Gemini + 通配路由 + 401 错误场景 |
| Test E | 扩展配置：`chrome.storage.local` 读写 + 嵌套对象 + 恢复 |
| Test F | 提供商下拉框：`#aiProvider` ≥ 5 个选项且含 OpenAI/Anthropic/Gemini |
| Test G | 通用面板字段：切换提供商 → `#genericApiKeyLabel` 等标签更新 |
| Test I | 模型选择加载状态：`#genericModel` 从 disabled 到 enabled 并填充 |
| Test J | 弹窗页语言→storage 往返：改语言 → 读 `chrome.storage.local` |

> **注意**：Test H（API Key 密码框可见性切换）已移除——该功能尚未实现（`apiKeyGeneric` 为纯文本输入，无 `type="password"` 也无切换按钮）。

### 文件结构

```
tests/mcp-e2e/
└── start-test-servers.js   # 启动 mock LLM（端口 8788）+ 静态测试页面服务器（随机端口）
.claude/skills/
└── run-e2e-mcp.md          # MCP E2E 测试指令（9 个测试，A-G + I-J）
```

### 运行方式

在 Claude Code 中输入 `/run-e2e-mcp`，自动执行 9 个组件测试：

| 测试 | 验证内容 |
|------|----------|
| Test A | Google 翻译：触发翻译 → `<translated>` 节点出现 |
| Test B | 按钮 UI：内联按钮组 + AI 按钮存在且可见 |
| Test C | SW→Mock 直连：SW fetch Mock 服务器 → `🌐[aimock]` 响应正确 |
| Test D | 多提供商：OpenRouter + Anthropic + Gemini + 通配路由 + 401 错误场景 |
| Test E | 扩展配置：`chrome.storage.local` 读写 + 嵌套对象 + 恢复 |
| Test F | 提供商下拉框：`#aiProvider` ≥ 5 个选项且含 OpenAI/Anthropic/Gemini |
| Test G | 通用面板字段：切换提供商 → `#genericApiKeyLabel` 等标签更新 |
| Test I | 模型选择加载状态：`#genericModel` 从 disabled 到 enabled 并填充 |
| Test J | 弹窗页语言→storage 往返：改语言 → 读 `chrome.storage.local` |

### MCP 配置

在 `.mcp.json` 中配置 `chrome-devtools-mcp`（官方 Google Chrome DevTools MCP v1.3.0）并启用 `--category-extensions`。Skill 定义在 `.claude/skills/run-e2e-mcp.md`。

---

## 编写新测试的惯例

### 1. 文件位置

测试文件放在与 `src/` 对应的子目录中：

```
src/contentScript/aiUiState.js   →  tests/contentScript/aiUiState.test.js
src/lib/ai/providerRegistry.js   →  tests/ai/providerRegistry.test.js
src/background/actionClick*.js   →  tests/background/actionClick*.test.js
```

### 2. 纯函数优先

如果被测模块是纯函数（无副作用、无 Chrome API 依赖），直接导入并断言返回值，**不需要任何 mock**：

```js
import { resolveDesktopToggleTranslationMessage } from "../../src/background/actionClickHelpers.js";

test("tab 未翻译时应返回 translateThisPage", () => {
  const msg = resolveDesktopToggleTranslationMessage({
    pageIsTranslated: false,
    targetLang: "zh",
  });
  expect(msg).toBe("translateThisPage");
});
```

### 3. Mock Chrome API 时使用共享工厂

不要手写 chrome mock。使用 `createMockChrome()`：

```js
import { createMockChrome } from "../fixtures/chrome/mockChrome.js";

beforeEach(() => { globalThis.chrome = createMockChrome(); });
afterEach(() => { delete globalThis.chrome; });
```

### 4. 集成测试命名

跨模块测试文件名必须包含 `.integration.`：

```
goodName.integration.test.js   ✓
goodName.test.js               ✓（单元测试）
goodName.spec.js               ✗（vitest 不包含 .spec）
```

### 5. 需要真实 HTTP 的测试

使用 `beforeAll`/`afterAll` 管理服务器生命周期，不要在每个 test 中启停：

```js
let server;
beforeAll(async () => { server = await startAimockLlmServer(0); }); // port 0 = 随机端口
afterAll(async () => { await stopAimockLlmServer(server); });
```

### 6. DOM 测试的本地工厂

每个测试文件定义自己的 DOM 工厂函数，不要共享全局 document：

```js
function createDom() {
  return new JSDOM('<div id="genericAiSettings"><input id="genericApiKey"></div>');
}
```

### 7. Vitest 配置已启用

- `globals: true` — `describe`/`test`/`expect`/`vi` 等无需 import
- `restoreMocks: true` — 每个测试后自动恢复所有 mock
