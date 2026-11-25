#!/usr/bin/env node
// Rebuilds the site's changelog (/changelog, #219) from GitHub: every pull request merged into
// main that is labelled `enhancement`, or that closes an issue labelled `enhancement`, as
// { date, number, title }, newest first. The page reads the JSON file this writes, so the site
// needs no GitHub call at runtime. Needs the `gh` CLI, signed in; run it from the repo.
//
//   npm run changelog              # writes packages/horizon-fe/src/view/pages/changelog/changelog.json
//   npm run changelog -- --check   # exits 1 if the file is out of date (writes nothing)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = 'enhancement';
const LIMIT = '1000';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'packages/horizon-fe/src/view/pages/changelog/changelog.json');

function gh(args) {
    const text = execFileSync('gh', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
    return JSON.parse(text);
}

// Issues labelled enhancement, open or closed: a PR that closes one is a user-facing change
const issues = gh([
    'issue',
    'list',
    '--state',
    'all',
    '--label',
    LABEL,
    '--limit',
    LIMIT,
    '--json',
    'number'
]);
const enhancement_issues = new Set(issues.map(i => i.number));

const prs = gh([
    'pr',
    'list',
    '--base',
    'main',
    '--state',
    'merged',
    '--limit',
    LIMIT,
    '--json',
    'number,title,mergedAt,labels,closingIssuesReferences'
]);

const entries = prs
    .filter(
        pr =>
            pr.labels.some(l => l.name === LABEL) ||
            (pr.closingIssuesReferences || []).some(i => enhancement_issues.has(i.number))
    )
    .map(pr => ({
        date: pr.mergedAt.slice(0, 10),
        number: pr.number,
        // "Add saved views (#146)" -> "Add saved views": the page links the PR itself
        title: pr.title.replace(/\s*\(#\d+\)\s*$/, '').trim()
    }))
    .sort((a, b) => (a.date === b.date ? b.number - a.number : a.date < b.date ? 1 : -1));

const json = JSON.stringify(entries, null, 4) + '\n';

if (process.argv.includes('--check')) {
    let current = '';
    try {
        current = readFileSync(out, 'utf8');
    } catch {
        // missing: out of date
    }
    if (current !== json) {
        console.error(`${out} is out of date: run npm run changelog`);
        process.exit(1);
    }
    console.log(`changelog is up to date (${entries.length} entries)`);
} else {
    writeFileSync(out, json);
    console.log(`wrote ${entries.length} entries to ${out}`);
}
