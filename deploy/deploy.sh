#!/usr/bin/env bash
# Deploy InvokeDB to the production server from this Mac. The images are built on the server, so
# the Mac needs no Docker. Settings come from deploy/prod.env (see prod.env.example).
#
#   deploy/deploy.sh init-env      create deploy/prod.env with random passwords (once)
#   deploy/deploy.sh bootstrap     install Docker etc. on a fresh server (once)
#   deploy/deploy.sh up            ship the committed HEAD and prod.env, build, migrate, (re)start
#   deploy/deploy.sh env           ship prod.env only, then restart what it changed
#   deploy/deploy.sh install-ci <key.pub>
#                                  let that key run only ci-deploy.sh (the GitHub deploy workflow)
#   deploy/deploy.sh init-db       disable the seeded demo accounts (once, after the first up)
#   deploy/deploy.sh migrate       run pending migrations only
#   deploy/deploy.sh backup run | list | verify [stamp] | restore <stamp> | install
#                                  off-site backups (deploy/backup.sh, on the server)
#   deploy/deploy.sh ps | logs [service] | ssh
#   deploy/deploy.sh compose <args>   any docker compose command on the server
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
ENV_FILE="$DIR/prod.env"
REMOTE=/opt/invokedb/app
REMOTE_ENV=/opt/invokedb/prod.env   # outside the app folder, so deploys never touch it
cmd="${1:-}"; shift || true

if [ "$cmd" = init-env ]; then
  [ -e "$ENV_FILE" ] && { echo "$ENV_FILE already exists"; exit 1; }
  awk -v pg="$(openssl rand -hex 24)" -v mr="$(openssl rand -hex 24)" \
      -v ma="$(openssl rand -hex 24)" -v ws="$(openssl rand -hex 24)" \
      -v bk="$(openssl rand -hex 32)" -v tk="$(openssl rand -hex 32)" '
    /^POSTGRES_PASSWORD=$/       { print $0 pg; next }
    /^MONGO_ROOT_PASSWORD=$/     { print $0 mr; next }
    /^MONGO_APP_PASSWORD=$/      { print $0 ma; next }
    /^HORIZON_WS_SERVER_TOKEN=$/ { print $0 ws; next }
    /^HORIZON_TOTP_KEY=$/        { print $0 tk; next }
    /^BACKUP_PASSPHRASE=$/       { print $0 bk; next }
    { print }' "$DIR/prod.env.example" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Wrote $ENV_FILE. Set DEPLOY_HOST and ACME_EMAIL, then run: npm run secrets:push"
  exit 0
fi

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE (run: deploy/deploy.sh init-env)"; exit 1; }
set -a
# prod.env is a gitignored secret
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a
[ -n "${DEPLOY_HOST:-}" ] || { echo "Set DEPLOY_HOST in $ENV_FILE"; exit 1; }
SSH_OPTS=(-i "${DEPLOY_SSH_KEY:-$HOME/.ssh/id_rsa}" -o StrictHostKeyChecking=accept-new)
SSH=(ssh "${SSH_OPTS[@]}" "root@$DEPLOY_HOST")
compose="cd $REMOTE/deploy && docker compose --env-file $REMOTE_ENV"

ship() {
  if [ -n "$(git -C "$ROOT" status --porcelain -- deploy packages examples)" ]; then
    echo "Note: uncommitted changes are NOT deployed (this ships HEAD $(git -C "$ROOT" rev-parse --short HEAD))"
  fi
  echo "Shipping $(git -C "$ROOT" rev-parse --short HEAD) to $DEPLOY_HOST"
  # The React example's image (#340) is built from examples/ (it imports the client's source)
  git -C "$ROOT" archive --format=tar HEAD deploy packages/horizon-be packages/horizon-fe examples \
    | "${SSH[@]}" "rm -rf $REMOTE.new && mkdir -p $REMOTE.new && tar -x -C $REMOTE.new \
        && rm -rf $REMOTE.old && { [ ! -d $REMOTE ] || mv $REMOTE $REMOTE.old; } \
        && mv $REMOTE.new $REMOTE && rm -rf $REMOTE.old \
        && echo $(git -C "$ROOT" rev-parse HEAD) > $REMOTE/REVISION"
  push_env
}

push_env() { "${SSH[@]}" "umask 077 && cat > $REMOTE_ENV.new && mv $REMOTE_ENV.new $REMOTE_ENV" < "$ENV_FILE"; }

case "$cmd" in
  bootstrap) "${SSH[@]}" 'bash -s' < "$DIR/bootstrap.sh" ;;
  up)
    ship
    "${SSH[@]}" "bash $REMOTE/deploy/release.sh"
    ;;
  env)
    push_env
    "${SSH[@]}" "$compose up -d && $compose ps"
    ;;
  install-ci)
    pub="${1:?usage: deploy.sh install-ci <public key file>}"
    read -r ktype kdata _ < "$pub"
    "${SSH[@]}" "install -m 755 /dev/stdin /opt/invokedb/ci-deploy.sh" < "$DIR/ci-deploy.sh"
    # Replace any earlier CI key; leave every other key alone ($f expands on the server)
    # shellcheck disable=SC2016
    printf 'command="/opt/invokedb/ci-deploy.sh",restrict %s %s invokedb-ci\n' "$ktype" "$kdata" \
      | "${SSH[@]}" 'f=/root/.ssh/authorized_keys; { grep -v " invokedb-ci$" "$f" || true; cat; } \
          > "$f.new" && chmod 600 "$f.new" && mv "$f.new" "$f"'
    echo "Installed. That key can now only run: deploy <sha of main's tip>"
    ;;
  migrate) "${SSH[@]}" "$compose run --rm migrate" ;;
  init-db)
    "${SSH[@]}" "$compose exec -T postgres psql -v ON_ERROR_STOP=1 -U horizon -d horizon" \
      < "$DIR/disable-seed-accounts.sql"
    ;;
  # -t: `restore` asks for confirmation
  backup) ssh -t "${SSH_OPTS[@]}" "root@$DEPLOY_HOST" "$REMOTE/deploy/backup.sh $*" ;;
  ps) "${SSH[@]}" "$compose ps" ;;
  logs) "${SSH[@]}" "$compose logs --tail=200 -f $*" ;;
  compose) "${SSH[@]}" "$compose $*" ;;
  ssh) "${SSH[@]}" ;;
  *) sed -n '2,18p' "$0"; exit 1 ;;
esac
