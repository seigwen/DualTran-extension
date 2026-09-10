#!/usr/bin/env bash
# pre-push verify (L3): 一键本地校验，push 前必须运行。
#
# 覆盖：
#   1. 5 个 lint 脚本（断言强度 / 模式对称 / 规则对称 / i18n / UI 状态初始化）
#   2. 全量 vitest
#   3. 构建（webpack）
#
# 用法：npm run verify
# 任意一步失败 → 非零退出，阻止 push 前的遗漏。
#
# 说明：项目是 solo dev + agent 协作流，CI 已强制「全绿才可合并」，
# 本脚本补的是「推之前本地验证」——避免 CI 反复红浪费 25 分钟/轮。

set -euo pipefail
cd "$(dirname "$0")/.."

echo "── 1/3 lint 检查 ──"
node scripts/check-assertion-strength.js
node scripts/check-mode-symmetry.mjs
node scripts/check-rule-symmetry.js
node scripts/check-no-chinese.js
node scripts/check-ui-state-init.js
node scripts/check-observer-mount.js

echo ""
echo "── 2/3 全量单元测试 ──"
npm test

echo ""
echo "── 3/3 构建 ──"
npm run build

echo ""
echo "✅ verify 全部通过——可以 push"
