#!/usr/bin/env bash
# Copy secret files between the repo (gitignored) and the Dropbox secret folder.
#   scripts/secrets.sh pull [--force]   secret folder -> repo
#   scripts/secrets.sh push [--force]   repo -> secret folder
#   scripts/secrets.sh status           show which copies differ
# Without --force, a copy is skipped when the destination is newer than the source.
# Paths starting with ~/ are files in $HOME (e.g. the production SSH key); their copy in the
# secret folder lives under home/.

# "~/" in FILES is a literal marker that local_path and secret_path expand, not a path.
# shellcheck disable=SC2088
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRET_DIR="${INVOKEDB_SECRET_DIR:-$HOME/Library/CloudStorage/Dropbox/dropbox/secret/invokedb}"

# Paths relative to both the repo root and SECRET_DIR (repo files must be gitignored), or ~/ paths.
FILES=(
  .env
  deploy/prod.env
  "~/.ssh/invokedb"
  "~/.ssh/invokedb.pub"
)

local_path() { case "$1" in "~/"*) echo "$HOME/${1#\~/}" ;; *) echo "$ROOT/$1" ;; esac; }
secret_path() { case "$1" in "~/"*) echo "$SECRET_DIR/home/${1#\~/}" ;; *) echo "$SECRET_DIR/$1" ;; esac; }

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
  case "$dst" in "$HOME/.ssh/"*.pub) ;; "$HOME/.ssh/"*) chmod 600 "$dst" ;; esac
  echo "  copied    $label"
}

for f in "${FILES[@]}"; do
  case "$f" in "~/"*) continue ;; esac
  if ! git -C "$ROOT" check-ignore -q "$f"; then echo "Refusing: $f is not gitignored"; exit 1; fi
done

case "$cmd" in
  pull) echo "secret -> repo"; for f in "${FILES[@]}"; do copy "$(secret_path "$f")" "$(local_path "$f")" "$f"; done ;;
  push) echo "repo -> secret"; for f in "${FILES[@]}"; do copy "$(local_path "$f")" "$(secret_path "$f")" "$f"; done ;;
  status)
    for f in "${FILES[@]}"; do
      a="$(local_path "$f")"; b="$(secret_path "$f")"
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
