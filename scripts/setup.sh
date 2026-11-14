#!/usr/bin/env bash
# One-time setup: install deps for every package, create .env, set up databases.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
cd "$HORIZON_ROOT"
npm install --no-audit --no-fund
# --omit=optional skips the native Postgres log transport (needs a C toolchain; only used in prod)
npm --prefix packages/horizon-be install --no-audit --no-fund --omit=optional
for pkg in horizon-fe horizon-auth-fe; do
  echo "== Installing $pkg"
  npm --prefix "packages/$pkg" install --no-audit --no-fund
done
bash scripts/db-setup.sh
echo
echo "Setup complete. Run: npm run dev"
