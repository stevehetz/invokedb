// The onboarding funnel (#169): how many new accounts reach each step, and how long after signing
// up. Pure functions over the onboarding documents (OnboardingManager), unit-tested in
// onboarding-funnel.spec.ts; `src/cli/onboarding-funnel.ts` reads the documents and prints it.
import type { OnboardingState } from './onboarding';

// In the order a new account goes through them. A step counts as reached when its own time or a
// later step's time is recorded: an API call needs a key, a key needs a verified email, and the
// times of steps done another way (a call made from the API docs, or an account verified by a
// password reset) may be missing.
export const FUNNEL_STEPS = [
    { id: 'signed_up', field: 'signed_up_at' },
    { id: 'verified_email', field: 'email_verified_at' },
    { id: 'created_table', field: 'table_created_at' },
    { id: 'viewed_api_key', field: 'key_viewed_at' },
    { id: 'copied_command', field: 'command_copied_at' },
    { id: 'called_api', field: 'api_called_at' }
] as const satisfies ReadonlyArray<{ id: string; field: keyof OnboardingState }>;

export type FunnelStepId = (typeof FUNNEL_STEPS)[number]['id'];

export interface FunnelOptions {
    // Epoch ms: only accounts that signed up in [since, until)
    since?: number;
    until?: number;
}

export interface FunnelStep {
    id: FunnelStepId;
    // Accounts that reached the step
    accounts: number;
    // Share of the accounts that signed up, 0..1 (0 when none did)
    share: number;
    // Median ms from signing up to the step, over the accounts with a recorded time for it;
    // null when none has one
    median_ms: number | null;
}

export interface Funnel {
    since: number | null;
    until: number | null;
    // Accounts that signed up in the period (the funnel's first step)
    accounts: number;
    // Onboarding documents with no signup time: accounts made before #169 recorded it
    without_signup_time: number;
    steps: FunnelStep[];
    dismissed: number;
    // The headline number: median time from signing up to the first API call
    median_ms_to_first_call: number | null;
}

const is_time = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function median(values: number[]): number | null {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function build_funnel(
    states: Array<OnboardingState | null | undefined>,
    opts: FunnelOptions = {}
): Funnel {
    const since = is_time(opts.since) ? opts.since : null;
    const until = is_time(opts.until) ? opts.until : null;

    let without_signup_time = 0;
    const cohort: OnboardingState[] = [];
    for (const state of states) {
        if (!state) continue;
        const signed_up_at = state.signed_up_at;
        if (!is_time(signed_up_at)) {
            without_signup_time++;
            continue;
        }
        if (since !== null && signed_up_at < since) continue;
        if (until !== null && signed_up_at >= until) continue;
        cohort.push(state);
    }

    const steps: FunnelStep[] = FUNNEL_STEPS.map((step, i) => {
        const later_fields = FUNNEL_STEPS.slice(i).map(s => s.field);
        let accounts = 0;
        const durations: number[] = [];
        for (const state of cohort) {
            if (later_fields.some(f => is_time(state[f]))) accounts++;
            const at = state[step.field];
            // A time before signup is from an account that predates #169's signup record
            if (is_time(at) && at >= state.signed_up_at) durations.push(at - state.signed_up_at);
        }
        return {
            id: step.id,
            accounts,
            share: cohort.length ? accounts / cohort.length : 0,
            median_ms: median(durations)
        };
    });

    return {
        since,
        until,
        accounts: cohort.length,
        without_signup_time,
        steps,
        dismissed: cohort.filter(s => is_time(s.dismissed_at)).length,
        median_ms_to_first_call: steps[steps.length - 1].median_ms
    };
}

// "3d 4h", "2h 5m", "45s": two units at most, enough to read a median
export function format_duration(ms: number | null): string {
    if (ms === null) return '-';
    const s = Math.round(ms / 1000);
    const units: Array<[string, number]> = [
        ['d', 86400],
        ['h', 3600],
        ['m', 60],
        ['s', 1]
    ];
    const parts: string[] = [];
    let rest = s;
    for (const [name, size] of units) {
        const n = Math.floor(rest / size);
        rest -= n * size;
        if (n || parts.length) parts.push(`${n}${name}`);
        if (parts.length === 2) break;
    }
    if (!parts.length) return '0s';
    // Drop a trailing zero unit ("2d 0h" reads as "2d")
    if (parts.length === 2 && parts[1].startsWith('0')) parts.pop();
    return parts.join(' ');
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function format_funnel(funnel: Funnel): string {
    const period =
        funnel.since === null && funnel.until === null
            ? 'all time'
            : `${funnel.since === null ? '…' : day(funnel.since)} to ${
                  funnel.until === null ? 'now' : day(funnel.until)
              }`;
    const width = Math.max(...FUNNEL_STEPS.map(s => s.id.length));
    const lines = [
        `Onboarding funnel, accounts that signed up ${period}`,
        '',
        `${'step'.padEnd(width)}  accounts  share  median time from signup`
    ];
    for (const step of funnel.steps) {
        const share = `${Math.round(step.share * 100)}%`;
        const median = step.id === 'signed_up' ? '' : format_duration(step.median_ms);
        lines.push(
            `${step.id.padEnd(width)}  ${String(step.accounts).padStart(8)}  ${share.padStart(
                5
            )}  ${median}`.trimEnd()
        );
    }
    lines.push(
        '',
        `Median time from signup to the first API call: ${format_duration(
            funnel.median_ms_to_first_call
        )}`,
        `Dismissed the checklist: ${funnel.dismissed}`
    );
    if (funnel.without_signup_time) {
        lines.push(
            `Left out: ${funnel.without_signup_time} older account(s) with no signup time (#169)`
        );
    }
    return lines.join('\n');
}

// The CLI's arguments: --since YYYY-MM-DD, --until YYYY-MM-DD (UTC days, until is exclusive),
// --days N (the last N days), --json
export function parse_funnel_args(
    argv: string[],
    now = Date.now()
): FunnelOptions & { json: boolean } {
    const out: FunnelOptions & { json: boolean } = { json: false };
    const parse_day = (flag: string, v: string | undefined) => {
        if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(`${v}T00:00:00Z`))) {
            throw new Error(`${flag} needs a date like 2026-11-01`);
        }
        return Date.parse(`${v}T00:00:00Z`);
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--json') out.json = true;
        else if (arg === '--since') out.since = parse_day(arg, argv[++i]);
        else if (arg === '--until') out.until = parse_day(arg, argv[++i]);
        else if (arg === '--days') {
            const v = argv[++i];
            if (!v || !/^\d+$/.test(v) || Number(v) < 1) {
                throw new Error('--days needs a whole number of days, 1 or more');
            }
            out.since = now - Number(v) * 86400 * 1000;
        } else throw new Error(`Unknown argument: ${arg}`);
    }
    return out;
}
