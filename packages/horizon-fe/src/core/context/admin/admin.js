// How the admin area (#277) shows its numbers. Formatting only; every number comes from the
// backend's /admin routes.
import { bytes_label, count_label } from '@/core/context/plan/plan';

export { bytes_label, count_label };

// The plans an admin can choose (until Stripe, #129)
export const ADMIN_PLANS = [
    { id: 'FREE', label: 'Free' },
    { id: 'STARTER', label: 'Starter' },
    { id: 'PRO', label: 'Pro' },
    { id: 'INTERNAL', label: 'Internal (no caps)' }
];

// The accounts list's sortable columns
export const ACCOUNT_COLUMNS = [
    { key: 'email', label: 'Email' },
    { key: 'plan', label: 'Plan' },
    { key: 'created_at', label: 'Created' },
    { key: 'last_active_at', label: 'Last active' },
    { key: 'tables', label: 'Tables' },
    { key: 'rows', label: 'Rows' },
    { key: 'storage_bytes', label: 'Storage' },
    { key: 'api_calls', label: 'API calls' },
    { key: 'ai_cost_usd', label: 'AI cost' }
];

/** @type {Record<string, string>} */
const CAP_LABELS = {
    tables: 'tables',
    rows_per_account: 'rows',
    rows_per_table: 'rows per table',
    storage_bytes: 'storage',
    api_calls_per_month: 'API calls'
};

/**
 * "tables 3/3": one cap an account is at, over or near.
 * @param {{ limit: string, used: number, cap: number }} flag
 */
export function cap_label(flag) {
    const fmt = flag.limit === 'storage_bytes' ? bytes_label : count_label;
    return `${CAP_LABELS[flag.limit] || flag.limit} ${fmt(flag.used)}/${fmt(flag.cap)}`;
}

/** @param {number | null | undefined} at */
export function date_label(at) {
    return at ? new Date(at).toLocaleDateString() : '—';
}

/** @param {number | null | undefined} at */
export function time_label(at) {
    return at ? new Date(at).toLocaleString() : '—';
}

/** @param {number} usd */
export function usd_label(usd) {
    const n = Number(usd) || 0;
    return `$${n < 1 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`;
}

/**
 * The sign-ups chart's bars: each day's height in percent of the busiest day.
 * @param {Array<{ day: string, count: number }>} days
 */
export function signup_bars(days) {
    const max = days.reduce((m, d) => Math.max(m, d.count), 0);
    return days.map(d => ({
        day: d.day,
        count: d.count,
        percent: max > 0 ? Math.round((d.count / max) * 100) : 0
    }));
}
