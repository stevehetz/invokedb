#!/usr/bin/env bash
# One-time setup: install deps for every package, create .env, set up databases.
set -euo pipefail
# Pull secrets (.env, deploy/prod.env) from the Dropbox secret folder if it's there
bash "$(dirname "${BASH_SOURCE[0]}")/secrets.sh" pull || echo "(no secret folder; using .env.example defaults)"
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
cd "$HORIZON_ROOT"
# Root install; its postinstall installs both packages (scripts/install-packages.sh)
npm install --no-audit --no-fund
bash scripts/db-setup.sh
echo
echo "Setup complete. Run: npm run dev"
