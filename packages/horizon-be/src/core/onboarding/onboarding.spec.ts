import { execFileSync } from 'node:child_process';
import {
    API_KEY_PLACEHOLDER,
    build_onboarding,
    first_call_command,
    first_call_url,
    markable_step,
    STEP_IDS
} from './onboarding';

const BASE = 'https://api.invokedb.com/api/v1';
const KEY = 'abcDEF0123456789abcDEF0123456789';
const done_of = (view: ReturnType<typeof build_onboarding>) =>
    Object.fromEntries(view.steps.map(s => [s.id, s.done]));

describe('build_onboarding', () => {
    it('shows every step undone for a new account', () => {
        const view = build_onboarding({ state: null, table: null, base_url: BASE });
        expect(view.show).toBe(true);
        expect(view.complete).toBe(false);
        expect(view.steps.map(s => s.id)).toEqual([...STEP_IDS]);
        expect(view.steps.every(s => !s.done)).toBe(true);
        expect(view.first_call).toBeNull();
    });

    it('ticks "create a table" from the account having one, and offers the command', () => {
        const view = build_onboarding({ state: {}, table: 'people', base_url: BASE });
        expect(done_of(view)).toEqual({
            create_table: true,
            view_api_key: false,
            copy_command: false,
            call_api: false
        });
        expect(view.first_call).toEqual({
            table: 'people',
            url: `${BASE}/get?table=people&skip=0&limit=10`,
            command: first_call_command(BASE, 'people', API_KEY_PLACEHOLDER),
            key_placeholder: API_KEY_PLACEHOLDER
        });
        expect(view.first_call.command).toContain(`Bearer ${API_KEY_PLACEHOLDER}'`);
    });

    it('ticks the steps the app recorded', () => {
        const view = build_onboarding({
            state: { key_viewed_at: 1, command_copied_at: 2 },
            table: 'people',
            base_url: BASE
        });
        expect(done_of(view)).toEqual({
            create_table: true,
            view_api_key: true,
            copy_command: true,
            call_api: false
        });
        expect(view.complete).toBe(false);
    });

    it('treats a successful API call as having done the key and command steps', () => {
        const view = build_onboarding({
            state: { api_called_at: 3 },
            table: 'people',
            base_url: BASE
        });
        expect(view.steps.every(s => s.done)).toBe(true);
        expect(view.complete).toBe(true);
        expect(view.show).toBe(true);
    });

    it('is hidden once dismissed, done or not', () => {
        const view = build_onboarding({
            state: { dismissed_at: 5 },
            table: null,
            base_url: BASE
        });
        expect(view.show).toBe(false);
        expect(view.complete).toBe(false);
    });

    it('never has a real key in the command: keys are only shown when made (#138)', () => {
        const view = build_onboarding({ state: {}, table: 't', base_url: BASE });
        expect(view.first_call.command).toBe(first_call_command(BASE, 't', API_KEY_PLACEHOLDER));
    });
});

describe('markable_step', () => {
    it('accepts only the steps the app reports', () => {
        expect(markable_step('view_api_key')).toBe('view_api_key');
        expect(markable_step('copy_command')).toBe('copy_command');
        expect(markable_step('call_api')).toBeNull();
        expect(markable_step('create_table')).toBeNull();
        expect(markable_step('dismissed_at')).toBeNull();
        expect(markable_step(undefined)).toBeNull();
        expect(markable_step(['view_api_key'])).toBeNull();
    });
});

describe('first_call_url / first_call_command', () => {
    it('trims trailing slashes from the base', () => {
        expect(first_call_url(`${BASE}//`, 'a')).toBe(`${BASE}/get?table=a&skip=0&limit=10`);
    });

    it('encodes the table name, including characters a shell would see', () => {
        expect(first_call_url(BASE, "my table!'()*&$`")).toBe(
            `${BASE}/get?table=my%20table%21%27%28%29%2A%26%24%60&skip=0&limit=10`
        );
    });

    it('is one line with the key in an Authorization header', () => {
        const cmd = first_call_command(BASE, 'people', KEY);
        expect(cmd).toBe(
            `curl '${BASE}/get?table=people&skip=0&limit=10' -H 'Authorization: Bearer ${KEY}'`
        );
        expect(cmd).not.toContain('\n');
    });

    it('passes the URL and header to curl unchanged through a shell', () => {
        const table = `it's "odd" $HOME \`x\` !`;
        const cmd = first_call_command(BASE, table, KEY);
        // Replace curl with printf to see the arguments the shell hands it
        const argv = execFileSync('sh', ['-c', `printf '%s\\n' ${cmd.slice('curl '.length)}`], {
            encoding: 'utf8'
        });
        expect(argv).toBe(`${first_call_url(BASE, table)}\n-H\nAuthorization: Bearer ${KEY}\n`);
    });
});
