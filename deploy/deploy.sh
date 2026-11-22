#!/usr/bin/env bash
# Deploy InvokeDB to the production server from this Mac. The images are built on the server, so
# the Mac needs no Docker. Settings come from deploy/prod.env (see prod.env.example).
#
#   deploy/deploy.sh init-env      create deploy/prod.env with random passwords (once)
#   deploy/deploy.sh bootstrap     install Docker etc. on a fresh server (once)
#   deploy/deploy.sh up            ship the committed HEAD, build, migrate, (re)start
#   deploy/deploy.sh init-db       disable the seeded demo accounts (once, after the first up)
#   deploy/deploy.sh migrate       run pending migrations only
#   deploy/deploy.sh ps | logs [service] | ssh
#   deploy/deploy.sh compose <args>   any docker compose command on the server
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
ENV_FILE="$DIR/prod.env"
REMOTE=/opt/invokedb/app
cmd="${1:-}"; shift || true

if [ "$cmd" = init-env ]; then
  [ -e "$ENV_FILE" ] && { echo "$ENV_FILE already exists"; exit 1; }
  awk -v pg="$(openssl rand -hex 24)" -v mr="$(openssl rand -hex 24)" \
      -v ma="$(openssl rand -hex 24)" -v ws="$(openssl rand -hex 24)" '
    /^POSTGRES_PASSWORD=$/       { print $0 pg; next }
    /^MONGO_ROOT_PASSWORD=$/     { print $0 mr; next }
    /^MONGO_APP_PASSWORD=$/      { print $0 ma; next }
    /^HORIZON_WS_SERVER_TOKEN=$/ { print $0 ws; next }
    { print }' "$DIR/prod.env.example" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Wrote $ENV_FILE. Set DEPLOY_HOST and ACME_EMAIL, then run: npm run secrets:push"
  exit 0
fi

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE (run: deploy/deploy.sh init-env)"; exit 1; }
set -a; source "$ENV_FILE"; set +a
[ -n "${DEPLOY_HOST:-}" ] || { echo "Set DEPLOY_HOST in $ENV_FILE"; exit 1; }
SSH=(ssh -i "${DEPLOY_SSH_KEY:-$HOME/.ssh/id_rsa}" -o StrictHostKeyChecking=accept-new "root@$DEPLOY_HOST")
compose="cd $REMOTE/deploy && docker compose --env-file prod.env"

ship() {
  if [ -n "$(git -C "$ROOT" status --porcelain -- deploy packages)" ]; then
    echo "Note: uncommitted changes are NOT deployed (this ships HEAD $(git -C "$ROOT" rev-parse --short HEAD))"
  fi
  echo "Shipping $(git -C "$ROOT" rev-parse --short HEAD) to $DEPLOY_HOST"
  git -C "$ROOT" archive --format=tar HEAD deploy packages/horizon-be packages/horizon-fe \
    | "${SSH[@]}" "rm -rf $REMOTE.new && mkdir -p $REMOTE.new && tar -x -C $REMOTE.new \
        && rm -rf $REMOTE.old && { [ ! -d $REMOTE ] || mv $REMOTE $REMOTE.old; } \
        && mv $REMOTE.new $REMOTE && rm -rf $REMOTE.old"
  "${SSH[@]}" "umask 077 && cat > $REMOTE/deploy/prod.env" < "$ENV_FILE"
}

case "$cmd" in
  bootstrap) "${SSH[@]}" 'bash -s' < "$DIR/bootstrap.sh" ;;
  up)
    ship
    "${SSH[@]}" "$compose build && $compose run --rm migrate && $compose up -d --remove-orphans \
      && $compose up -d --force-recreate --no-deps web && $compose ps"
    ;;
  migrate) "${SSH[@]}" "$compose run --rm migrate" ;;
  init-db)
    "${SSH[@]}" "$compose exec -T postgres psql -v ON_ERROR_STOP=1 -U horizon -d horizon" \
      < "$DIR/disable-seed-accounts.sql"
    ;;
  ps) "${SSH[@]}" "$compose ps" ;;
  logs) "${SSH[@]}" "$compose logs --tail=200 -f $*" ;;
  compose) "${SSH[@]}" "$compose $*" ;;
  ssh) "${SSH[@]}" ;;
  *) sed -n '2,13p' "$0"; exit 1 ;;
esac
