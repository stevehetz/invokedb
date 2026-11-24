#!/usr/bin/env bash
# The only thing the GitHub deploy key can run on the server: its authorized_keys line forces this
# script (installed to /opt/invokedb/ci-deploy.sh by `deploy.sh install-ci`; rerun that after
# changing this file). The deploy workflow sends `deploy <sha>`. The commit is deployed only if
# it's the current tip of main, and it's downloaded from the public repo on GitHub, so a leaked
# key can only redeploy what's already on main. The settings (/opt/invokedb/prod.env) aren't
# touched: they sit outside the app folder and only `deploy.sh up`/`env` write them.
set -euo pipefail
REPO=stevehetz/invokedb
APP=/opt/invokedb/app
ENV=/opt/invokedb/prod.env

read -r verb sha extra <<<"${SSH_ORIGINAL_COMMAND:-}" || true
if [ "${verb:-}" != deploy ] || ! [[ "${sha:-}" =~ ^[0-9a-f]{40}$ ]] || [ -n "${extra:-}" ]; then
  echo "usage: deploy <40-character commit sha>" >&2
  exit 2
fi

exec 9>/opt/invokedb/deploy.lock
flock -w 1800 9 || { echo "Another deploy is still running" >&2; exit 1; }

tip=$(curl -fsS -H 'Accept: application/vnd.github.sha' \
  "https://api.github.com/repos/$REPO/commits/main")
if [ "$tip" != "$sha" ]; then
  echo "$sha is no longer the tip of main ($tip), so it isn't deployed (the newer run will be)"
  exit 0
fi

# Before 2026-11-24 the settings lived in the app folder; move them out once
if [ ! -f "$ENV" ] && [ -f "$APP/deploy/prod.env" ]; then
  install -m 600 "$APP/deploy/prod.env" "$ENV"
fi
[ -f "$ENV" ] || { echo "Missing $ENV (run deploy.sh env from the Mac)" >&2; exit 1; }

echo "Deploying $sha"
top="${REPO#*/}-$sha"
rm -rf "$APP.new"
mkdir -p "$APP.new"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$sha" \
  | tar -xz -C "$APP.new" --strip-components=1 \
    "$top/deploy" "$top/packages/horizon-be" "$top/packages/horizon-fe"
echo "$sha" > "$APP.new/REVISION"
rm -rf "$APP.old"
mv "$APP" "$APP.old"
mv "$APP.new" "$APP"
rm -rf "$APP.old"

exec bash "$APP/deploy/release.sh"
