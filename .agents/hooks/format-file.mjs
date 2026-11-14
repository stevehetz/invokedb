#!/usr/bin/env node
// Formats files with the repo's root prettier after an agent edits them.
//
// Works as a Claude Code PostToolUse hook (reads the hook JSON on stdin and formats
// tool_input.file_path) or by hand: node .agents/hooks/format-file.mjs <file>...
//
// Always exits 0 so a formatting problem never blocks an edit. Files matched by
// .prettierignore, and file types prettier doesn't know, are skipped.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Always use the root prettier: the Vue CLI packages carry their own prettier 1.19.
const prettier = path.join(root, 'node_modules/.bin/prettier');

let files = process.argv.slice(2);
if (files.length === 0 && !process.stdin.isTTY) {
    try {
        const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
        const file = input.tool_input?.file_path || input.tool_input?.notebook_path;
        if (file) files = [file];
    } catch {
        // Not hook JSON; nothing to do.
    }
}

files = files.map(f => path.resolve(f)).filter(f => f.startsWith(root + path.sep) && existsSync(f));

if (files.length && existsSync(prettier)) {
    try {
        execFileSync(prettier, ['--write', '--ignore-unknown', '--log-level', 'warn', ...files], {
            cwd: root,
            stdio: ['ignore', 'ignore', 'pipe']
        });
    } catch (err) {
        // Usually a syntax error in the edited file. Surface it without failing the edit.
        process.stderr.write(`prettier: ${err.stderr?.toString().trim() || err.message}\n`);
    }
}
process.exit(0);
