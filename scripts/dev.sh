#!/usr/bin/env bash
# Start the backend and the frontend (public site at /, app at /app) with a shared env. Ctrl-C stops everything.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
cd "$HORIZON_ROOT"
exec npx concurrently --kill-others-on-fail \
  --names "be,fe" --prefix-colors "blue,green" \
  "npm --prefix packages/horizon-be start" \
  "npm --prefix packages/horizon-fe start"
