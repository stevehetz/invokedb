import { http } from '@/core/http';

// The public status page (#212): GET /status answers each check's state and the admin's note.

export const status_http = {
    async status() {
        return http.get(http.get_url('/status'));
    }
};

/** The page's headline for the overall status. */
export const OVERALL_LABELS = {
    operational: 'All systems operational',
    degraded: 'Some systems are degraded',
    outage: 'Major outage'
};

/** Each check's state, in words. */
export const STATE_LABELS = {
    operational: 'Operational',
    degraded: 'Degraded',
    down: 'Down',
    unknown: 'No recent result'
};

/** What each check means, for the page. */
export const CHECK_NOTES = {
    api: 'The app and /api/v1',
    database: 'A round trip to each database',
    processor:
        'CSV uploads, URL imports and syncs, webhooks, exports, AI columns',
    e2e: 'Signs in and works a table on production, nightly and after each deploy'
};

export const INCIDENT_LABELS = {
    info: 'Notice',
    degraded: 'Degraded',
    outage: 'Outage'
};

/** @param {number | null} ms */
export function ago_label(ms, now = Date.now()) {
    if (!ms) return '';
    const s = Math.max(0, Math.round((now - ms) / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} h ago`;
    return `${Math.round(h / 24)} days ago`;
}
