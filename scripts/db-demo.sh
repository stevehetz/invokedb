#!/usr/bin/env bash
# Replace your local InvokeDB data with the demo dataset (ops/shared/dumps/demo).
# Drops Postgres horizon/horizon_logs and Mongo horizon* databases first.
#   scripts/db-demo.sh        asks for confirmation
#   scripts/db-demo.sh --yes  no prompt
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
DUMP="$HORIZON_ROOT/ops/shared/dumps/demo"

if [ "${1:-}" != "--yes" ]; then
  read -r -p "This replaces all local InvokeDB data with the demo dataset. Continue? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

export PGOPTIONS="-c client_min_messages=warning" PGHOST="$HORIZON_POSTGRES_HOST" PGPORT="$HORIZON_POSTGRES_PORT" \
       PGUSER="$HORIZON_POSTGRES_USERNAME" PGPASSWORD="$HORIZON_POSTGRES_PASSWORD"
DB="$HORIZON_POSTGRES_DB"
LOGS_DB="${DB}_logs"

echo "Recreating Postgres databases $DB, $LOGS_DB"
for name in "$DB" "$LOGS_DB"; do
  psql -d postgres -qc "DROP DATABASE IF EXISTS \"$name\" WITH (FORCE)"
  psql -d postgres -qc "CREATE DATABASE \"$name\""
done
psql -d "$LOGS_DB" -q -f "$HORIZON_ROOT/ops/shared/log-table.sql"
pg_restore --no-owner --no-privileges -d "$DB" "$DUMP/postgres/horizon.bak"

echo "Restoring Mongo databases"
mongosh "$HORIZON_MONGO_URI" --quiet --eval '
  db.adminCommand({ listDatabases: 1 }).databases
    .filter(d => d.name.startsWith("horizon"))
    .forEach(d => db.getSiblingDB(d.name).dropDatabase())'
mongorestore --uri "$HORIZON_MONGO_URI" --drop --quiet --nsInclude 'horizon*' "$DUMP/mongo"

echo "Running pending migrations"
cd "$HORIZON_ROOT/packages/horizon-be"
npm run --silent migration:run > /dev/null
echo "Demo data loaded. Log in as demo@invokedb.com / password"
