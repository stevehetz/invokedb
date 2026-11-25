#!/usr/bin/env bash
# Write a throwaway env file for smoke tests: bash scripts/smoke-env.sh <out-file>
# Copies .env (or .env.example), then points every database, file share, port and URL at
# separate "smoke" values, so a smoke stack can't touch your data or collide with `npm run dev`.
#   DBs: Postgres horizon_smoke, Mongo horizon_smoke*
#   Ports: be 8101, ws 9100, fe 8100
# Use it with HORIZON_ENV_FILE=<out-file>. Never with db:reset or db:demo: their Mongo drop
# matches every horizon* database, not just the smoke ones.
set -euo pipefail
OUT="${1:?usage: smoke-env.sh <out-file>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/.env"
[ -f "$SRC" ] || SRC="$ROOT/.env.example"
cp "$SRC" "$OUT"
cat >> "$OUT" <<'VARS'

# ---- smoke overrides (scripts/smoke-env.sh) ----
HORIZON_POSTGRES_DB=horizon_smoke
HORIZON_MONGO_DB=horizon_smoke
HORIZON_MONGO_TRACKING_DB=horizon_smoke:tracking
HORIZON_FILE_SHARE=${HORIZON_ROOT}/.data/smoke
HORIZON_FE_PUB_HTTP_PORT=8100
HORIZON_BE_PRIV_HTTP_PORT=8101
HORIZON_SB_PRIV_WS_PORT=9100
HORIZON_FE_PUB_HTTP_URL=http://127.0.0.1:8100
HORIZON_BE_PUB_HTTP_URL=http://127.0.0.1:8101
HORIZON_API_PUB_HTTP_URL=http://127.0.0.1:8101/api
HORIZON_PRC_PUB_HTTP_URL=http://127.0.0.1:8101
HORIZON_FS_PUB_HTTP_URL=http://127.0.0.1:8101
HORIZON_SB_PUB_WS_URL=ws://127.0.0.1:9100
HORIZON_SB_PRIV_WS_URL=ws://127.0.0.1:9100
# api-smoke.mjs's webhook receiver (#140): allowed although it's on loopback
HORIZON_WEBHOOK_TEST_HOSTS=127.0.0.1:8199
# api-smoke.mjs's stub of the Anthropic Messages API (#149): no real model is called
ANTHROPIC_API_KEY=smoke-anthropic-key
ANTHROPIC_BASE_URL=http://127.0.0.1:8197
VARS
echo "Wrote $OUT"
