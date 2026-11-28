import { defineComponent } from 'vue';
import { store } from '@/store';

/**
 * @typedef {{ name: string, what: string, file?: string }} Step
 */

// The delivery pipeline, in order: an issue on the board to production (AGENTS.md "How work
// is tracked", docs/OPERATIONS.md "Delivery"). Keep it in step with .github/workflows/.
/** @type {Step[]} */
const PIPELINE = [
    {
        name: 'Issue on the board',
        what:
            'Every change starts as a GitHub issue with a "Done when" checklist, ' +
            'in priority order on a GitHub Project board. The owner labels it ' +
            '"agent" to hand it to the cloud agent.'
    },
    {
        name: 'Queue',
        file: 'agent-queue.yml',
        what:
            'Starts the next labelled issue in board order, one at a time, when ' +
            'nothing else is in flight.'
    },
    {
        name: 'Implement',
        file: 'implement.yml',
        what:
            'Claude Code works the issue in GitHub Actions: a branch, the change, ' +
            'the build, lint and unit tests, then a pull request that closes the issue.'
    },
    {
        name: 'CI',
        file: 'ci.yml',
        what:
            'Backend build, lint and unit tests; an API smoke test against the ' +
            'built backend with real Postgres and Mongo; frontend build, lint and ' +
            'typecheck; the example clients; shellcheck and prettier.'
    },
    {
        name: 'Claude review',
        file: 'review.yml',
        what:
            'Reviews the diff and checks it against the issue’s "Done when" ' +
            'items, then labels the PR "review-ok" or "review-changes".'
    },
    {
        name: 'Auto-merge',
        file: 'automerge.yml',
        what:
            'Merges a PR that passed CI and got "review-ok", unless it touches ' +
            'deploy files, workflows or migrations: those wait for the owner.'
    },
    {
        name: 'Deploy',
        file: 'cd.yml',
        what:
            'After CI passes on main, opens SSH on the firewall for the runner ' +
            'alone, deploys the commit (build, migrate, restart) and closes it again.'
    },
    {
        name: 'End-to-end test',
        file: 'e2e.yml',
        what:
            'Drives the live site in a real browser as a test account after every ' +
            'deploy and every night, and alerts on Telegram when it fails.'
    }
];

// The workflows around the main line, which keep it moving without a person
/** @type {Step[]} */
const HELPERS = [
    {
        name: 'Revise',
        file: 'revise.yml',
        what:
            'When the review asks for changes, Claude fixes each finding or ' +
            'answers why not, at most two rounds.'
    },
    {
        name: 'Resolve',
        file: 'resolve.yml',
        what:
            'When another merge makes a PR conflict with main, Claude merges main ' +
            'in, resolves the conflicts and runs the checks.'
    },
    {
        name: 'Repair',
        file: 'repair.yml',
        what:
            'When CI, a deploy or the end-to-end test fails, Claude pushes a fix, ' +
            'opens a fix PR, or opens an issue with its diagnosis.'
    },
    {
        name: 'Security fixes',
        file: 'security-fix.yml',
        what:
            'Every 3 hours, fixes open CodeQL alerts in their own PRs, or ' +
            'dismisses a false positive with its reason.'
    },
    {
        name: 'Dependency updates',
        file: 'deps-update.yml',
        what:
            'On the 1st of each month, updates every npm package in two PRs ' +
            '(minor and patch, and majors) and drops a major it can’t make pass.'
    }
];

// Counted by hand from main's git history (first-parent merges of pull requests, and who made
// each PR's last commit). Update them, and AS_OF, when you refresh the page.
const AS_OF = '28 November 2026';
const NUMBERS = [
    { value: '167', label: 'pull requests merged into main (#1 to #339)' },
    { value: '86', label: 'of them written by Claude in GitHub Actions' },
    { value: '7', label: 'fixes for failed CI or deploys, from repair.yml' },
    { value: '6', label: 'CodeQL alerts fixed by security-fix.yml' }
];

// "How it's built" (#332): the architecture, the stack and the agent pipeline, for a
// technical reader. Every claim here comes from AGENTS.md, docs/OPERATIONS.md or deploy/.
export default defineComponent({
    name: 'HowItsBuilt',

    data() {
        return {
            /** @type {any} */
            account: null,
            /** @type {any} */
            account_sub: null,
            pipeline: PIPELINE,
            helpers: HELPERS,
            numbers: NUMBERS,
            as_of: AS_OF
        };
    },

    created() {
        this.account_sub = store.subscribe('account', account => {
            this.account = account;
        });
    },

    mounted() {
        document.title = "How it's built | InvokeDB";
    },

    beforeUnmount() {
        const sub = this.account_sub;
        if (sub && typeof sub.unsubscribe === 'function') sub.unsubscribe();
        document.title = 'InvokeDB';
    }
});
