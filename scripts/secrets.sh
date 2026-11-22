#!/usr/bin/env bash
# Copy secret files between the repo (gitignored) and the Dropbox secret folder.
#   scripts/secrets.sh pull [--force]   secret folder -> repo
#   scripts/secrets.sh push [--force]   repo -> secret folder
#   scripts/secrets.sh status           show which copies differ
# Without --force, a copy is skipped when the destination is newer than the source.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRET_DIR="${INVOKEDB_SECRET_DIR:-$HOME/Library/CloudStorage/Dropbox/dropbox/secret/invokedb}"

# Paths relative to both the repo root and SECRET_DIR. All must be gitignored.
FILES=(
  .env
  deploy/prod.env
  ops/azure-base/azure-base.values.sh
  ops/azure-prod/azure-prod-build.values.sh
  ops/azure-prod/azure-prod-env.values.sh
  ops/azure-prod/commands/ssh/keys/prod_horizon_id_rsa
  ops/azure-prod/commands/ssh/keys/prod_horizon_id_rsa.pub
)

cmd="${1:-status}"; force="${2:-}"
[ -d "$SECRET_DIR" ] || { echo "Secret folder not found: $SECRET_DIR (set INVOKEDB_SECRET_DIR)"; exit 1; }

copy() { # src dst label
  local src="$1" dst="$2" label="$3"
  if [ ! -e "$src" ]; then echo "  missing   $label"; return; fi
  if [ -e "$dst" ] && cmp -s "$src" "$dst"; then echo "  same      $label"; return; fi
  if [ -e "$dst" ] && [ "$dst" -nt "$src" ] && [ "$force" != "--force" ]; then
    echo "  SKIPPED   $label (destination is newer; rerun with --force to overwrite)"; return
  fi
  mkdir -p "$(dirname "$dst")"
  [ -L "$dst" ] && rm "$dst"   # replace old-style symlinks with real files
  cp -p "$src" "$dst"
  echo "  copied    $label"
}

for f in "${FILES[@]}"; do
  if ! git -C "$ROOT" check-ignore -q "$f"; then echo "Refusing: $f is not gitignored"; exit 1; fi
done

case "$cmd" in
  pull) echo "secret -> repo"; for f in "${FILES[@]}"; do copy "$SECRET_DIR/$f" "$ROOT/$f" "$f"; done ;;
  push) echo "repo -> secret"; for f in "${FILES[@]}"; do copy "$ROOT/$f" "$SECRET_DIR/$f" "$f"; done ;;
  status)
    for f in "${FILES[@]}"; do
      a="$ROOT/$f"; b="$SECRET_DIR/$f"
      if [ ! -e "$a" ] && [ ! -e "$b" ]; then s="missing both"
      elif [ ! -e "$a" ]; then s="only in secret"
      elif [ ! -e "$b" ]; then s="only in repo"
      elif cmp -s "$a" "$b"; then s="same"
      elif [ "$a" -nt "$b" ]; then s="repo newer"
      else s="secret newer"; fi
      printf "  %-15s %s\n" "$s" "$f"
    done ;;
  *) echo "usage: $0 pull|push|status [--force]"; exit 1 ;;
esac
