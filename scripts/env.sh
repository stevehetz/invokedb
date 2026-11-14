#!/usr/bin/env bash
# Source this to load .env into the current shell: `source scripts/env.sh`
HORIZON_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export HORIZON_ROOT
# HORIZON_ENV_FILE lets you point at an alternate env file (e.g. for testing)
HORIZON_ENV_FILE="${HORIZON_ENV_FILE:-$HORIZON_ROOT/.env}"
if [ ! -f "$HORIZON_ENV_FILE" ]; then
  cp "$HORIZON_ROOT/.env.example" "$HORIZON_ENV_FILE"
  echo "Created $HORIZON_ENV_FILE from .env.example"
fi
set -a
# shellcheck disable=SC1090
source "$HORIZON_ENV_FILE"
set +a
mkdir -p "$HORIZON_FILE_SHARE/temp"
