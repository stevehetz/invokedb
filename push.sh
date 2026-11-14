#!/bin/bash
# Bump the patch version of the repo + all packages, commit, tag, push.
#   npm run push "your commit message"
set -euo pipefail
[ -n "${1:-}" ] || { echo 'usage: npm run push "commit message"'; exit 1; }

version=$(node -e '
const fs = require("fs");
const files = ["package.json", ...fs.readdirSync("packages").map(p => `packages/${p}/package.json`)];
const [maj, min, pat] = require("./package.json").version.split(".").map(Number);
const v = `${maj}.${min}.${pat + 1}`;
for (const f of files) {
  const raw = fs.readFileSync(f, "utf8");
  fs.writeFileSync(f, raw.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`));
}
console.log(v);')

git add -A
git commit -m "$1"
git tag "v$version"
git push origin HEAD --follow-tags
echo "Pushed v$version"
