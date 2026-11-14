#!/usr/bin/env bash
# Run an npm script in horizon-be with .env loaded: scripts/be-run.sh migration:create -n Name
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
cd "$HORIZON_ROOT/packages/horizon-be"
script="$1"; shift
npm run "$script" -- "$@"
