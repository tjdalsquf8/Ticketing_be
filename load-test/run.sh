#!/bin/bash
# 스윕 테스트 1회분 실행 + 결과 자동 기록.
#
# 사전 조건: 서버가 원하는 DB_POOL_MAX / LIVE_PROMOTE_BATCH_CAP .env 값으로
#           재시작되어 있어야 함(env는 재시작 없이 반영 안 됨). 회차도 새로 열어둘 것
#           (좌석 재고 리셋 안 하면 스윕 결과 비교 불공정).
#
# 사용:
#   load-test/run.sh <label>
#   VUS=600 DURATION=20s BASE_URL=http://localhost:8081 load-test/run.sh pool30_batch20
#
# label은 results.csv에 그대로 기록되는 식별자. 예: pool30_batch20, pool50_batchUnlimited
set -euo pipefail
cd "$(dirname "$0")/.."

LABEL="${1:?Usage: run.sh <label>}"

POOL_MAX=$( (grep -E '^DB_POOL_MAX=' .env || true) | cut -d= -f2 )
BATCH_CAP=$( (grep -E '^LIVE_PROMOTE_BATCH_CAP=' .env || true) | cut -d= -f2 )
POOL_MAX="${POOL_MAX:-30}"
BATCH_CAP="${BATCH_CAP:-0}"

SUMMARY_FILE="/tmp/k6-summary-${LABEL}.json"

echo "[run] label=${LABEL} poolMax(.env)=${POOL_MAX} batchCap(.env)=${BATCH_CAP}"
echo "[run] .env 값이 실제 실행 중인 서버와 일치하는지 확인 후 계속하세요 (env는 재시작해야 반영됨)."

k6 run --summary-export="$SUMMARY_FILE" load-test/live-ticketing.js

node load-test/log-result.js "$LABEL" "$SUMMARY_FILE" "$POOL_MAX" "$BATCH_CAP"
