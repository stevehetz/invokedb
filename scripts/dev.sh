#!/usr/bin/env bash
# Start backend + both frontends with a shared env. Ctrl-C stops everything.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
cd "$HORIZON_ROOT"
exec npx concurrently --kill-others-on-fail \
  --names "be,fe,auth" --prefix-colors "blue,green,magenta" \
  "npm --prefix packages/horizon-be start" \
  "npm --prefix packages/horizon-fe start" \
  "npm --prefix packages/horizon-auth-fe start"
