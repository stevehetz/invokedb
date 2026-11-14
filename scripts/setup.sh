#!/usr/bin/env bash
# One-time setup: install deps for every package, create .env, set up databases.
set -euo pipefail
# Pull secrets (.env, Azure values) from the Dropbox secret folder if it's there
bash "$(dirname "${BASH_SOURCE[0]}")/secrets.sh" pull || echo "(no secret folder; using .env.example defaults)"
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
cd "$HORIZON_ROOT"
npm install --no-audit --no-fund
# --omit=optional skips the native Postgres log transport (needs a C toolchain; only used in prod)
npm --prefix packages/horizon-be install --no-audit --no-fund --omit=optional
npm --prefix packages/horizon-fe install --no-audit --no-fund
bash scripts/db-setup.sh
echo
echo "Setup complete. Run: npm run dev"
