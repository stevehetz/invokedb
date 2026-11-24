#!/usr/bin/env bash
# Replace your local InvokeDB data with the demo dataset: fresh databases (the migrations seed
# the demo accounts), then the example tables from examples/data, loaded through the API by
# examples/setup.mjs into demo@invokedb.com.
# Drops Postgres $HORIZON_POSTGRES_DB and Mongo horizon* databases first.
#   scripts/db-demo.sh        asks for confirmation
#   scripts/db-demo.sh --yes  no prompt
# Stop `npm run dev` first: this starts its own backend for the load and stops it afterwards.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
BASE="$HORIZON_BE_PUB_HTTP_URL"

if [ "${1:-}" != "--yes" ]; then
  read -r -p "This replaces all local InvokeDB data with the demo dataset. Continue? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

if curl -fsS -o /dev/null "$BASE/auth/authorize" 2>/dev/null; then
  echo "A backend is already answering on $BASE. Stop it (npm run dev) and run this again."
  exit 1
fi

bash "$HORIZON_ROOT/scripts/db-setup.sh" --reset

echo "Starting a backend to load the example tables"
LOG="$(mktemp -t invokedb-demo-be.XXXXXX)"
(cd "$HORIZON_ROOT/packages/horizon-be" &&
  IS_TS_NODE=true exec node_modules/.bin/ts-node -r tsconfig-paths/register src/main.ts) > "$LOG" 2>&1 &
BE_PID=$!
trap 'kill "$BE_PID" 2>/dev/null || true; wait "$BE_PID" 2>/dev/null || true' EXIT

for _ in $(seq 120); do
  curl -fsS -o /dev/null "$BASE/auth/authorize" 2>/dev/null && break
  kill -0 "$BE_PID" 2>/dev/null || { echo "The backend exited. Its log:"; cat "$LOG"; exit 1; }
  sleep 1
done
curl -fsS -o /dev/null "$BASE/auth/authorize" || { echo "The backend didn't start. Log: $LOG"; exit 1; }

node "$HORIZON_ROOT/examples/setup.mjs" --base "$BASE"
rm -f "$LOG"
echo "Demo data loaded. Log in as demo@invokedb.com / password"
