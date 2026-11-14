#!/usr/bin/env node
// Formats staged files with the repo's root prettier. Run by .githooks/pre-commit.
//
// - Fully staged files are formatted and re-staged.
// - Partly staged files (unstaged edits too) are only checked, because re-staging them
//   would also commit the unstaged hunks. They get a warning; run `npm run format`.
// - Files in .prettierignore and file types prettier doesn't know are skipped.
// - A file prettier can't parse blocks the commit (skip with `git commit --no-verify`).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Always the root prettier: horizon-fe's ESLint packages carry their own prettier 1.19.
const prettier = path.join(root, 'node_modules/.bin/prettier');

const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);

if (!existsSync(prettier)) {
    console.warn('pre-commit: root prettier not installed (run npm install); skipping format');
    process.exit(0);
}

const staged = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z');
const unstaged = new Set(git('diff', '--name-only', '-z'));
const full = staged.filter(f => !unstaged.has(f));
const partial = staged.filter(f => unstaged.has(f));

const run = (args, files) =>
    spawnSync(prettier, [...args, '--ignore-unknown', '--log-level', 'warn', ...files], {
        cwd: root,
        stdio: 'inherit'
    }).status;

if (full.length) {
    if (run(['--write'], full) !== 0) {
        console.error(
            'pre-commit: prettier failed (see above). Fix it, or commit with --no-verify.'
        );
        process.exit(1);
    }
    execFileSync('git', ['add', '--', ...full], { cwd: root });
}

if (partial.length && run(['--check'], partial) !== 0) {
    console.warn(
        'pre-commit: the partly staged files above are not formatted. Committing anyway;\n' +
            'run `npm run format` and commit the result when convenient.'
    );
}
