# AGENTS.md — DualTran 协作者铁律

此文件对任何在本仓库工作的 agent/协作者生效（Claude Code、其他 AI 工具、人类协作者）。CLAUDE.md 是完整规则，此文件是不可违反的铁律子集。

## Git 提交铁律

**所有 git message 统一使用英文**（commit message、PR 标题、PR 正文）。禁止中文 commit message。仓库文档（CLAUDE.md / 计划文档）可用中文，但 git 历史必须全英文。

## 状态架构铁律（最高优先级）

1. **SSOT（单一事实源）**：UI 状态（`highlight` / `displayMode` / `intervention` / `googleInFlight` / `aiInFlight`）唯一事实源是 `src/contentScript/uiStateStore.js`。**禁止在闭包/组件内持有状态副本**，禁止裸赋值（`highlight = ...` / `displayMode = ...`），所有变更必须走 `setState()`。
2. **重建派生**：任何跨 SPA 导航/重建（`show()`/`resetForRebuild`）的 UI 初始化，必须从引擎状态派生（`getState()` → `resolveInitialUiState`），**禁止硬编码初始值**。
3. **事件是通知不是查询**：UI 不能只依赖事件（`onXxxChange`）知道状态——事件只在状态变化时触发。必须有查询路径（`getState()`）。
4. **状态机合法表**：状态转换必须合法（见 `uiStateStore` 状态机），非法转换（如页面原文时 AI 高亮）必须被拒绝并告警。
5. **Watchdog 边界**：引擎驱动状态不一致时必须自愈；**用户选择（`intervention=true`）不得被纠正**。

## 测试铁律

1. **测试先行**：bug 修复必须先写复现测试（RED），修复到 GREEN 后才能提交。无测试的修复 = 未完成。
2. **生命周期矩阵**：任何 UI 状态改动必须测试跨重建/跨导航的状态保持（A1 矩阵）。
3. **一致性断言**：任何翻译/恢复/导航相关测试必须附带 UI 状态与引擎状态一致断言（`assertUiStateMatchesEngine`）。
4. **全量验证**：push 前必须 `npm test`（全量 vitest）+ `npm run build` + 5 个 lint 脚本 + E2E（`xvfb-run -a`）。

## 代码铁律

1. **精确补丁**：只用 patch 工具 + 精确上下文。禁止 sed/awk 批量替换（历史上有 3 次事故）。
2. **i18n**：`src/` 下所有字符串必须走 i18n（`_locales/`），注释必须纯英文（CI hard failure）。
3. **规则落档**：任何新规则/新教训必须写入根 `CLAUDE.md` 或 `tests/CLAUDE.md` 或 dualtran-extension skill，禁止只存在口头/临时记忆中。

## 诊断铁律（状态 bug）

1. 先用 `uiStateStore.dumpLog()` 回溯状态变更历史——**禁止直接改代码盲猜**。
2. 对照 skill「状态同步失败模式清单」（M1-M5）定位模式。
3. 修复后补：生命周期矩阵测试 + 一致性断言 + 防呆 lint。

## 违反后果

- 违反状态架构铁律 → 状态 bug 复发（5 次历史事故的温床）
- 违反测试先行 → 用户明确禁止（历史教训：无测试推送被发怒）
- 违反精确补丁 → 代码损坏（历史上有 3 次批量替换事故）

---

参考：
- 完整规则：`CLAUDE.md`
- 测试规则：`tests/CLAUDE.md`
- 架构计划：`/root/DualTran-manage/08-ui-state-ssot-plan.md`
- 复盘分析：`/root/DualTran-manage/07-spa-highlight-bug-test-architecture-analysis.md`
