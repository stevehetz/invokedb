#!/usr/bin/env bash
# Runs on the server, from the shipped app (/opt/invokedb/app/deploy): build both images, run the
# migrations, then (re)start everything. Used by `deploy.sh up` and by ci-deploy.sh.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
compose() { docker compose --env-file /opt/invokedb/prod.env "$@"; }

compose build
compose run --rm migrate
compose up -d --remove-orphans
compose up -d --force-recreate --no-deps web
compose ps
