import {
    E2E_STALE_MS,
    IncidentError,
    MAX_INCIDENT,
    PROCESSOR_DOWN_MS,
    PROCESSOR_LATE_MS,
    SLOW_DATABASE_MS,
    api_check,
    database_check,
    e2e_check,
    incident_of,
    overall_status,
    parse_incident,
    processor_check
} from './status';

const NOW = 1_800_000_000_000;

describe('checks', () => {
    it('api: operational once the websocket is ready', () => {
        expect(api_check(true).state).toBe('operational');
        expect(api_check(false).state).toBe('degraded');
    });

    it('database: down when a round trip failed, degraded when slow', () => {
        expect(database_check(3, 4).state).toBe('operational');
        expect(database_check(SLOW_DATABASE_MS + 1, 4).state).toBe('degraded');
        expect(database_check(3, null).state).toBe('down');
        expect(database_check(null, 4).state).toBe('down');
    });

    it("processor: from its heartbeat's age", () => {
        expect(processor_check(NOW - 1000, NOW).state).toBe('operational');
        expect(processor_check(NOW - PROCESSOR_LATE_MS - 1, NOW).state).toBe('degraded');
        expect(processor_check(NOW - PROCESSOR_DOWN_MS - 1, NOW).state).toBe('down');
        expect(processor_check(null, NOW)).toMatchObject({ state: 'down', at: null });
    });

    it('e2e: a recent run, or unknown', () => {
        const run = { conclusion: 'success', at: NOW - 1000, url: 'https://github.com/x' };
        expect(e2e_check(run, NOW)).toMatchObject({ state: 'operational', url: run.url });
        expect(e2e_check({ ...run, conclusion: 'failure' }, NOW).state).toBe('degraded');
        expect(e2e_check({ ...run, conclusion: 'cancelled' }, NOW).state).toBe('unknown');
        expect(e2e_check({ ...run, at: NOW - E2E_STALE_MS - 1 }, NOW).state).toBe('unknown');
        expect(e2e_check({ conclusion: 'unknown', at: null, url: null }, NOW).state).toBe(
            'unknown'
        );
    });
});

describe('overall_status', () => {
    const ok = [api_check(true), database_check(1, 1), processor_check(NOW, NOW)];

    it('is operational when every check is, whatever the E2E test', () => {
        expect(overall_status(ok, null)).toBe('operational');
        expect(
            overall_status(
                [...ok, e2e_check({ conclusion: 'unknown', at: null, url: null }, NOW)],
                null
            )
        ).toBe('operational');
    });

    it('is an outage when the API or the database is down', () => {
        expect(overall_status([api_check(true), database_check(null, 1)], null)).toBe('outage');
    });

    it('is degraded when anything else is wrong', () => {
        expect(overall_status([...ok.slice(0, 2), processor_check(null, NOW)], null)).toBe(
            'degraded'
        );
        expect(overall_status([api_check(false)], null)).toBe('degraded');
    });

    it("follows the admin's note", () => {
        const note = (level: any) => ({ message: 'm', level, updated_at: NOW });
        expect(overall_status(ok, note('info'))).toBe('operational');
        expect(overall_status(ok, note('degraded'))).toBe('degraded');
        expect(overall_status(ok, note('outage'))).toBe('outage');
    });
});

describe('incidents', () => {
    it('parse_incident checks the note and its level', () => {
        expect(parse_incident({ message: '  Slow imports  ' })).toEqual({
            message: 'Slow imports',
            level: 'info'
        });
        expect(parse_incident({ message: 'x', level: 'outage' }).level).toBe('outage');
        expect(() => parse_incident({})).toThrow(IncidentError);
        expect(() => parse_incident({ message: 'x', level: 'bad' })).toThrow(IncidentError);
        expect(() => parse_incident({ message: 'x'.repeat(MAX_INCIDENT + 1) })).toThrow(
            IncidentError
        );
    });

    it('incident_of reads the stored note', () => {
        expect(incident_of(null)).toBeNull();
        expect(incident_of({ message: '' })).toBeNull();
        expect(incident_of({ message: 'm', level: 'odd', updated_at: new Date(NOW) })).toEqual({
            message: 'm',
            level: 'info',
            updated_at: NOW
        });
    });
});
