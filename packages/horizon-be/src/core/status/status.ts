// The public status page (#212), from our own checks: the API, a round trip to each database,
// the job processor's heartbeat and the latest production E2E run, plus a note the admin can
// set. These are the pure rules; nothing here says more than a state and a time.

export type CheckState = 'operational' | 'degraded' | 'down' | 'unknown';
export type Overall = 'operational' | 'degraded' | 'outage';
export type IncidentLevel = 'info' | 'degraded' | 'outage';
export const INCIDENT_LEVELS: IncidentLevel[] = ['info', 'degraded', 'outage'];
export const MAX_INCIDENT = 1000;

// The processor writes its heartbeat this often
export const HEARTBEAT_EVERY_MS = 30 * 1000;
// A heartbeat older than this is degraded, older than the second down
export const PROCESSOR_LATE_MS = 2 * 60 * 1000;
export const PROCESSOR_DOWN_MS = 10 * 60 * 1000;
// A database round trip slower than this is degraded
export const SLOW_DATABASE_MS = 1000;
// The E2E test runs nightly and after each deploy; a result older than this says nothing
export const E2E_STALE_MS = 3 * 24 * 60 * 60 * 1000;
// The public answer is built at most this often
export const STATUS_CACHE_MS = 30 * 1000;

export interface Check {
    id: 'api' | 'database' | 'processor' | 'e2e';
    name: string;
    state: CheckState;
    // When the thing checked last showed it worked (heartbeat, E2E run), if it says
    at: number | null;
    url?: string | null;
}

export interface Incident {
    message: string;
    level: IncidentLevel;
    updated_at: number | null;
}

export class IncidentError extends Error {}

export function api_check(websocket_ready: boolean): Check {
    return {
        id: 'api',
        name: 'API',
        state: websocket_ready ? 'operational' : 'degraded',
        at: null
    };
}

/** Each database's round trip in ms, or null when it failed. */
export function database_check(postgres_ms: number | null, mongo_ms: number | null): Check {
    let state: CheckState = 'operational';
    if (postgres_ms === null || mongo_ms === null) state = 'down';
    else if (postgres_ms > SLOW_DATABASE_MS || mongo_ms > SLOW_DATABASE_MS) state = 'degraded';
    return { id: 'database', name: 'Database', state, at: null };
}

export function processor_check(heartbeat_at: number | null, now: number): Check {
    let state: CheckState = 'down';
    if (heartbeat_at !== null) {
        const age = now - heartbeat_at;
        if (age <= PROCESSOR_LATE_MS) state = 'operational';
        else if (age <= PROCESSOR_DOWN_MS) state = 'degraded';
    }
    return { id: 'processor', name: 'Background jobs', state, at: heartbeat_at };
}

export function e2e_check(
    e2e: { conclusion: string; at: number | null; url: string | null },
    now: number
): Check {
    let state: CheckState = 'unknown';
    const fresh = e2e.at !== null && now - e2e.at <= E2E_STALE_MS;
    if (fresh && e2e.conclusion === 'success') state = 'operational';
    else if (fresh && e2e.conclusion === 'failure') state = 'degraded';
    return {
        id: 'e2e',
        name: 'End-to-end test',
        state,
        at: e2e.at,
        url: e2e.url
    };
}

/**
 * The page's headline: an outage when the API or the database is down or the admin says so,
 * degraded when anything else is wrong or the admin says so.
 */
export function overall_status(checks: Check[], incident: Incident | null): Overall {
    let overall: Overall = 'operational';
    for (const c of checks) {
        if (c.state === 'down' && (c.id === 'api' || c.id === 'database')) return 'outage';
        if (c.state === 'down' || c.state === 'degraded') overall = 'degraded';
    }
    if (incident?.level === 'outage') return 'outage';
    if (incident?.level === 'degraded') overall = 'degraded';
    return overall;
}

/** The admin's note: `{ message, level }`. */
export function parse_incident(body: any): { message: string; level: IncidentLevel } {
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!message) throw new IncidentError('Write the note to show');
    if (message.length > MAX_INCIDENT) {
        throw new IncidentError(`The note can be at most ${MAX_INCIDENT} characters`);
    }
    const level = body?.level === undefined ? 'info' : body.level;
    if (!INCIDENT_LEVELS.includes(level)) {
        throw new IncidentError(`level must be one of ${INCIDENT_LEVELS.join(', ')}`);
    }
    return { message, level };
}

export function incident_of(doc: any): Incident | null {
    if (!doc || typeof doc.message !== 'string' || !doc.message) return null;
    const t = doc.updated_at ? new Date(doc.updated_at).getTime() : NaN;
    return {
        message: doc.message,
        level: INCIDENT_LEVELS.includes(doc.level) ? doc.level : 'info',
        updated_at: Number.isFinite(t) ? t : null
    };
}
