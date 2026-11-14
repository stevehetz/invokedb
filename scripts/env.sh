#!/usr/bin/env bash
# Source this to load .env into the current shell: `source scripts/env.sh`
HORIZON_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export HORIZON_ROOT
if [ ! -f "$HORIZON_ROOT/.env" ]; then
  cp "$HORIZON_ROOT/.env.example" "$HORIZON_ROOT/.env"
  echo "Created .env from .env.example"
fi
set -a
# shellcheck disable=SC1091
source "$HORIZON_ROOT/.env"
set +a
mkdir -p "$HORIZON_FILE_SHARE/temp"
# Vue CLI 4 / webpack 4 use md4 hashing, which Node 17+ disables by default
export NODE_OPTIONS="--openssl-legacy-provider ${NODE_OPTIONS:-}"
