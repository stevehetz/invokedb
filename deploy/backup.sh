#!/usr/bin/env bash
# Off-site backups. Runs ON THE SERVER, from the shipped copy in /opt/invokedb/app/deploy, as
# root. Drive it from the Mac with `deploy/deploy.sh backup <command>`.
#
#   backup.sh run              dump Postgres + Mongo, encrypt, upload, ping Healthchecks
#   backup.sh list             list the complete backups in the bucket
#   backup.sh verify [stamp]   restore a backup (default: latest) into throwaway containers and
#                              print its counts next to the live ones; touches no live data
#   backup.sh restore <stamp>  restore into the LIVE databases (stops api + prc; asks first)
#   backup.sh install          install the nightly cron job and its logrotate config
#
# Each backup is a folder <stamp>/ in the bucket holding postgres.dump.enc (pg_dump -Fc),
# mongo.archive.gz.enc (mongodump --archive --gzip) and manifest.txt (sha256 sums, uploaded
# last, so a folder without one is incomplete). The dumps are encrypted with BACKUP_PASSPHRASE
# (openssl AES-256, PBKDF2) before they leave the server. Retention is a lifecycle rule on the
# bucket (see deploy/README.md); this script never deletes anything remote.
set -euo pipefail
shopt -s inherit_errexit
export LC_ALL=C
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
set -a; source ./prod.env; set +a

WORK=/opt/invokedb/backups
LOG=/var/log/invokedb-backup.log
RCLONE_IMAGE=rclone/rclone:1.68.2
PG_IMAGE=postgres:17-alpine
MONGO_IMAGE=mongo:8
compose=(docker compose --env-file prod.env)
cmd="${1:-}"; shift || true

need() {
  local v
  for v in "$@"; do
    [ -n "${!v:-}" ] || { echo "Set $v in deploy/prod.env (then deploy/deploy.sh up)" >&2; exit 1; }
  done
}

# rclone in a container, configured from the environment (no config file, no secrets in argv)
export RCLONE_CONFIG_OFFSITE_TYPE=s3
export RCLONE_CONFIG_OFFSITE_PROVIDER=Other
export RCLONE_CONFIG_OFFSITE_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
export RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="${BACKUP_S3_KEY_ID:-}"
export RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET:-}"
export RCLONE_CONFIG_OFFSITE_NO_CHECK_BUCKET=true
rclone() {
  docker run --rm -v "$WORK:$WORK" \
    -e RCLONE_CONFIG_OFFSITE_TYPE -e RCLONE_CONFIG_OFFSITE_PROVIDER \
    -e RCLONE_CONFIG_OFFSITE_ENDPOINT -e RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID \
    -e RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY -e RCLONE_CONFIG_OFFSITE_NO_CHECK_BUCKET \
    "$RCLONE_IMAGE" "$@"
}
remote() { echo "offsite:$BACKUP_S3_BUCKET${1:+/$1}"; }

encrypt() { openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE "$@"; }
decrypt() { openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE "$@"; }

need_remote() { need BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_KEY_ID BACKUP_S3_SECRET BACKUP_PASSPHRASE; }

stamps() {
  rclone lsf -R --files-only --include '*/manifest.txt' "$(remote)" | sed 's#/manifest.txt$##' | sort
}

# Download a backup into $WORK/<stamp> and check its sums. Prints the folder.
fetch() {
  local stamp="$1" dest="$WORK/restore-$1"
  rm -rf "$dest"; mkdir -p "$dest"
  rclone copy "$(remote "$stamp")" "$dest" >&2
  [ -f "$dest/manifest.txt" ] || { echo "No complete backup named $stamp" >&2; exit 1; }
  (cd "$dest" && sha256sum --quiet -c manifest.txt) >&2
  echo "$dest"
}

# Row count of every public table; reads SQL on stdin via the given psql command
PG_COUNTS="SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I', table_name), false, true, '')))[1]::text
FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1;"
# Document count of every horizon* database
MONGO_COUNTS='db.adminCommand({ listDatabases: 1, nameOnly: true }).databases
  .map(d => d.name).filter(n => n.startsWith("horizon")).sort().forEach(n => {
    const d = db.getSiblingDB(n);
    print(n + "|" + d.getCollectionNames().reduce((t, c) => t + d.getCollection(c).estimatedDocumentCount(), 0));
  })'

live_pg_counts() { "${compose[@]}" exec -T postgres psql -U horizon -d horizon -At -F'|' -c "$PG_COUNTS"; }
live_mongo_counts() {
  "${compose[@]}" exec -T mongo sh -c 'mongosh --quiet -u root -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --eval "$0"' "$MONGO_COUNTS"
}

side_by_side() { # $1 = restored counts, $2 = live counts, both "name|n" lines
  printf '%-48s %12s %12s\n' NAME BACKUP LIVE
  join -t'|' -a1 -a2 -e- -o 0,1.2,2.2 <(echo "$1" | sort) <(echo "$2" | sort) \
    | awk -F'|' '{ printf "%-48s %12s %12s\n", $1, $2, $3 }'
}

do_run() {
  need_remote
  local stamp dest
  stamp="$(date -u +%Y-%m-%dT%H%MZ)"
  dest="$WORK/$stamp"
  rm -rf "$WORK"/20??-*; mkdir -p "$dest"; chmod 700 "$WORK"
  echo "$(date -u +%FT%TZ) backup $stamp: dumping"
  "${compose[@]}" exec -T postgres pg_dump -U horizon -d horizon -Fc \
    | encrypt -out "$dest/postgres.dump.enc"
  "${compose[@]}" exec -T mongo sh -c 'mongodump --quiet --archive --gzip -u root -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin' \
    | encrypt -out "$dest/mongo.archive.gz.enc"
  (cd "$dest" && sha256sum postgres.dump.enc mongo.archive.gz.enc > manifest.txt)
  echo "$(date -u +%FT%TZ) backup $stamp: uploading $(du -sh "$dest" | cut -f1)"
  rclone copy --exclude manifest.txt "$dest" "$(remote "$stamp")"
  rclone copy --include manifest.txt "$dest" "$(remote "$stamp")"
  rm -rf "$dest"
  echo "$(date -u +%FT%TZ) backup $stamp: done"
}

wait_for() { # $1 = what, then the check command; gives up after 90s
  local what="$1" i; shift
  for i in $(seq 90); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done
  echo "$what didn't start" >&2; return 1
}

ping_hc() { # $1 = "" | /start | /fail, $2 = body
  [ -n "${HEALTHCHECK_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "${2:-}" "$HEALTHCHECK_URL$1" || true
}

case "$cmd" in
  run)
    # A separate process, so `set -e` still applies (bash ignores it inside an `if`)
    ping_hc /start
    out="$(mktemp)"
    status=0
    bash "$0" _run > "$out" 2>&1 || status=$?
    cat "$out"
    if [ $status = 0 ]; then ping_hc '' "$(tail -c 9000 "$out")"; else ping_hc /fail "$(tail -c 9000 "$out")"; fi
    rm -f "$out"
    exit $status
    ;;
  _run) do_run ;;

  list) need_remote; stamps ;;

  verify)
    need_remote
    stamp="${1:-$(stamps | tail -1)}"
    [ -n "$stamp" ] || { echo "No backups yet" >&2; exit 1; }
    echo "Verifying $stamp"
    src="$(fetch "$stamp")"
    pg=invokedb-verify-pg mg=invokedb-verify-mongo
    trap 'docker rm -f $pg $mg >/dev/null 2>&1 || true; rm -rf "$src"' EXIT
    docker run -d --rm --name $pg -e POSTGRES_USER=horizon -e POSTGRES_PASSWORD=verify \
      -e POSTGRES_DB=horizon "$PG_IMAGE" >/dev/null
    docker run -d --rm --name $mg "$MONGO_IMAGE" --wiredTigerCacheSizeGB 0.25 >/dev/null
    wait_for Postgres docker exec $pg pg_isready -h 127.0.0.1 -U horizon -d horizon -q
    wait_for Mongo docker exec $mg mongosh --quiet --eval 'db.adminCommand("ping").ok'
    decrypt -in "$src/postgres.dump.enc" | docker exec -i $pg pg_restore -U horizon -d horizon --exit-on-error
    decrypt -in "$src/mongo.archive.gz.enc" \
      | docker exec -i $mg mongorestore --quiet --archive --gzip --nsExclude 'admin.*' --nsExclude 'config.*'
    echo; echo "Postgres (rows)"
    side_by_side "$(docker exec $pg psql -U horizon -d horizon -At -F'|' -c "$PG_COUNTS")" "$(live_pg_counts)"
    echo; echo "Mongo (documents)"
    side_by_side "$(docker exec $mg mongosh --quiet --eval "$MONGO_COUNTS")" "$(live_mongo_counts)"
    echo; echo "Restore of $stamp OK (live counts can be higher: they include writes since the backup)"
    ;;

  restore)
    need_remote
    stamp="${1:-}"
    [ -n "$stamp" ] || { echo "Usage: backup.sh restore <stamp> (see: backup.sh list)" >&2; exit 1; }
    src="$(fetch "$stamp")"
    trap 'rm -rf "$src"' EXIT
    echo "This REPLACES the live Postgres and Mongo data with backup $stamp."
    read -r -p "Type the stamp to confirm: " answer
    [ "$answer" = "$stamp" ] || { echo "Cancelled"; exit 1; }
    "${compose[@]}" stop api prc
    trap '"${compose[@]}" start api prc; rm -rf "$src"' EXIT
    decrypt -in "$src/postgres.dump.enc" | "${compose[@]}" exec -T postgres \
      pg_restore -U horizon -d horizon --clean --if-exists --single-transaction --exit-on-error
    decrypt -in "$src/mongo.archive.gz.enc" | "${compose[@]}" exec -T mongo sh -c \
      'mongorestore --quiet --archive --gzip --drop --nsExclude "admin.*" --nsExclude "config.*" -u root -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin'
    echo "Restored $stamp; starting api and prc"
    ;;

  install)
    cat > /etc/cron.d/invokedb-backup <<EOF
# Nightly off-site backup (deploy/backup.sh). Installed by: deploy/deploy.sh backup install
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
15 7 * * * root $DIR/backup.sh run >> $LOG 2>&1
EOF
    cat > /etc/logrotate.d/invokedb-backup <<EOF
$LOG {
  monthly
  rotate 6
  compress
  missingok
  notifempty
}
EOF
    echo "Installed: nightly at 07:15 UTC, log in $LOG"
    ;;

  *) sed -n '2,17p' "$0"; exit 1 ;;
esac
