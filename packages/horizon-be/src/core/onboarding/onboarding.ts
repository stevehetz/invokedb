// Onboarding checklist (#143): from a new account to a working API call. Pure functions, so
// they're unit-tested (onboarding.spec.ts). OnboardingManager stores the state, one document per
// account in the tracking database.
import { sh_quote } from '../table-docs/table-docs';

export const STEP_IDS = ['create_table', 'view_api_key', 'copy_command', 'call_api'] as const;
export type StepId = (typeof STEP_IDS)[number];

// What the app reports itself; "create_table" is read from the account's tables, and
// "call_api" is recorded by /api/v1 when a call succeeds (OnboardingInterceptor)
export const MARKABLE_STEPS = ['view_api_key', 'copy_command'] as const;
export type MarkableStep = (typeof MARKABLE_STEPS)[number];

// Times are epoch ms
export interface OnboardingState {
    key_viewed_at?: number;
    command_copied_at?: number;
    api_called_at?: number;
    dismissed_at?: number;
}

export const STEP_FIELDS: Record<MarkableStep, keyof OnboardingState> = {
    view_api_key: 'key_viewed_at',
    copy_command: 'command_copied_at'
};

export interface OnboardingInput {
    state: OnboardingState | null;
    // The table the command calls (the account's newest), or null if it has none
    table: string | null;
    // The /api/v1 base, e.g. https://api.invokedb.com/api/v1
    base_url: string;
}

export interface OnboardingView {
    // False once dismissed; it never comes back
    show: boolean;
    complete: boolean;
    steps: Array<{ id: StepId; done: boolean }>;
    first_call: { table: string; url: string; command: string; key_placeholder: string } | null;
}

// Keys are only shown when they're made (#138), so the command has this in place of the key; the
// app puts in a key made in the same visit, and the owner pastes theirs otherwise
export const API_KEY_PLACEHOLDER = 'YOUR_API_KEY';

export function markable_step(step: unknown): MarkableStep | null {
    return (MARKABLE_STEPS as readonly unknown[]).includes(step) ? (step as MarkableStep) : null;
}

// encodeURIComponent leaves !'()* alone; encode them too so the URL is safe in any quoting
function encode_strict(s: string) {
    return encodeURIComponent(s).replace(
        /[!'()*]/g,
        c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
    );
}

export function first_call_url(base_url: string, table: string) {
    let base = base_url;
    while (base.endsWith('/')) base = base.slice(0, -1);
    return `${base}/get?table=${encode_strict(table)}&skip=0&limit=10`;
}

// One line with the key in it, so it runs as pasted (a POSIX shell, or PowerShell's curl.exe)
// once the key replaces the placeholder
export function first_call_command(base_url: string, table: string, api_key: string) {
    const url = first_call_url(base_url, table);
    return `curl ${sh_quote(url)} -H ${sh_quote(`Authorization: Bearer ${api_key}`)}`;
}

export function build_onboarding(input: OnboardingInput): OnboardingView {
    const state = input.state || {};
    const called = !!state.api_called_at;
    // A call made another way (the API docs, their own code) means the earlier steps were done
    const done: Record<StepId, boolean> = {
        create_table: !!input.table,
        view_api_key: called || !!state.key_viewed_at,
        copy_command: called || !!state.command_copied_at,
        call_api: called
    };
    const steps = STEP_IDS.map(id => ({ id, done: done[id] }));
    const first_call = input.table
        ? {
              table: input.table,
              url: first_call_url(input.base_url, input.table),
              command: first_call_command(input.base_url, input.table, API_KEY_PLACEHOLDER),
              key_placeholder: API_KEY_PLACEHOLDER
          }
        : null;
    return {
        show: !state.dismissed_at,
        complete: steps.every(s => s.done),
        steps,
        first_call
    };
}
