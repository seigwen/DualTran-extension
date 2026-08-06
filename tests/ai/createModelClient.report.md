# createModelClient apiBase 优先级链测试报告

## 实现内容

创建了 `tests/ai/createModelClient.test.js`，包含 3 个测试用例，验证 `createModelClient` 函数的 apiBase 三级优先级链：

| 测试 | 描述 | 验证内容 |
|------|------|---------|
| C4.1 | `extra.baseURL` 优先于 `models.dev` api | 同时提供 extra.baseURL 和 models.dev api 时，使用 extra.baseURL |
| C4.2 | 无 `extra.baseURL` 时回退到 `models.dev` api | extra 为空对象时，使用 models.dev 缓存中的 api 字段 |
| C4.3 | 所有来源均无 apiBase 时抛出错误 | provider 不在 models.dev 且无 baseURL 时，抛出 `Unknown AI provider` 错误 |

## 测试结果

```bash
npx vitest run tests/ai/createModelClient.test.js
```

```
✓ tests/ai/createModelClient.test.js (3 tests) 260ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

### 回归测试

```bash
npx vitest run tests/ai/
```

```
✓ tests/ai/createModelClient.test.js (3 tests)
✓ tests/ai/aimockLlmServer.test.js (9 tests)
✓ tests/ai/sseClient.test.js (9 tests)
✓ tests/ai/fetchSSE.integration.test.js (27 tests)
✓ tests/ai/providerRegistry.test.js (16 tests)
✓ tests/ai/providerRouting.integration.test.js (44 tests)
✓ tests/ai/providerMigration.test.js (4 tests)
✓ tests/ai/aimockChaosStreaming.test.js (15 tests)

 Test Files  8 passed | 4 failed (12)
      Tests  127 passed (127)
```

127 tests 全部通过。4 个失败的测试文件为预存问题（`providerAdapter.test.js`、`mockLlmServer.test.js` 等依赖不存在文件 `providerAdapter.js`、`mock-llm-server.js`），与本次改动无关。

## 实现细节

- **Mock 策略**：通过 `vi.mock()` 工厂函数 + `vi.resetModules()` 确保每个测试用例获得全新的 mock 实例，兼容 vitest 配置中的 `restoreMocks: true`
- **缓存门槛**：使用 `buildModelsDevCache()` 生成 12 条填充数据确保通过 `getProvidersData` 的 `>10` 门槛
- **chrome.storage mock**：`chrome.storage.local.get` 返回 Promise，模拟真实异步行为
- **SDK mock**：mock 了 `aiProxy.js` 中导入的全部 13 个 `@ai-sdk/*` 包 + `ai` 包，避免模块解析错误
