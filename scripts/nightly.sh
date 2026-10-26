#!/usr/bin/env bash
# nightly.sh — plan 87 (P4): the checks that are too slow for every PR.
#
# Runs the dual-engine conformance matrix and the store audit, and speaks only when
# something is wrong (watchdog pattern: empty output means all good).
set -uo pipefail
cd /root/DualTran-extension || exit 1
LOG=/root/.hermes/logs/nightly-conformance.log
mkdir -p "$(dirname "$LOG")"

say() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG"; }

npm run build >/dev/null 2>&1 || { say "build failed"; /root/.hermes/scripts/notify.sh "夜间矩阵：Chromium 构建失败，后续检查已跳过。" "夜间矩阵构建失败" "任务受阻"; exit 1; }
npm run build:firefox >/dev/null 2>&1 || { say "firefox build failed"; /root/.hermes/scripts/notify.sh "夜间矩阵：Firefox 构建失败，后续检查已跳过。" "夜间矩阵构建失败" "任务受阻"; exit 1; }

CONF_OUT="$(xvfb-run -a --server-args="-screen 0 1280x900x24" node tests/conformance/run.mjs --engine=all 2>&1)"
CONF_RC=$?
say "conformance rc=$CONF_RC"
printf '%s\n' "$CONF_OUT" >>"$LOG"

STORE_OUT="$(node scripts/store/audit.mjs 2>&1)"
STORE_RC=$?
say "store rc=$STORE_RC"
printf '%s\n' "$STORE_OUT" >>"$LOG"

if [ "$CONF_RC" -ne 0 ] || [ "$STORE_RC" -ne 0 ]; then
  SUMMARY="$(printf '%s\n' "$CONF_OUT" | grep -E '^\[conformance\] [0-9]+/' | tail -1)
$(printf '%s\n' "$STORE_OUT" | grep -E '^FAIL|^\[store-audit\]' | tail -5)"
  /root/.hermes/scripts/notify.sh "夜间检查未通过（conformance rc=${CONF_RC}, store rc=${STORE_RC}）：
${SUMMARY}

日志：${LOG}" "夜间矩阵失败" "任务受阻"
  exit 1
fi

say "all green"
exit 0
