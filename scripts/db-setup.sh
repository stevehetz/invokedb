#!/usr/bin/env bash
# Create the Postgres database (if missing) and run migrations.
#   scripts/db-setup.sh          safe; creates what's missing, runs pending migrations
#   scripts/db-setup.sh --reset  drops InvokeDB's databases first (Postgres $HORIZON_POSTGRES_DB
#                                and Mongo databases starting with "horizon"); nothing else is touched
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

export PGOPTIONS="-c client_min_messages=warning" PGHOST="$HORIZON_POSTGRES_HOST" PGPORT="$HORIZON_POSTGRES_PORT" \
       PGUSER="$HORIZON_POSTGRES_USERNAME" PGPASSWORD="$HORIZON_POSTGRES_PASSWORD"
DB="$HORIZON_POSTGRES_DB"

if [ "${1:-}" = "--reset" ]; then
  echo "Dropping Postgres database $DB"
  psql -d postgres -qc "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)"
  echo "Dropping Mongo databases named horizon*"
  mongosh "$HORIZON_MONGO_URI" --quiet --eval '
    db.adminCommand({ listDatabases: 1 }).databases
      .filter(d => d.name.startsWith("horizon"))
      .forEach(d => { print("  " + d.name); db.getSiblingDB(d.name).dropDatabase(); })'
fi

echo "SELECT 'CREATE DATABASE \"$DB\"' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB')\gexec" \
  | psql -d postgres -q

echo "Running migrations"
cd "$HORIZON_ROOT/packages/horizon-be"
npm run --silent migration:run
echo "Database ready."
