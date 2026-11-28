// How the plans' caps are shown (#183): on the pricing page (GET /plans) and the Account page's
// usage meters (GET /usage). Formatting only; every number comes from the backend.

/** @param {number} n */
export function count_label(n) {
    return Number(n).toLocaleString('en-US');
}

/** @param {number} bytes */
export function bytes_label(bytes) {
    const KB = 1024;
    const MB = KB * 1024;
    const GB = MB * 1024;
    if (bytes >= GB) return `${Math.round((bytes / GB) * 10) / 10} GB`;
    if (bytes >= MB) return `${Math.round((bytes / MB) * 10) / 10} MB`;
    if (bytes >= KB) return `${Math.round((bytes / KB) * 10) / 10} KB`;
    return `${bytes} B`;
}

// The counted caps, in the order the usage meters show them
export const USAGE_ROWS = [
    { key: 'tables', label: 'Tables' },
    { key: 'rows_per_account', label: 'Rows (all tables)' },
    { key: 'rows_per_table', label: 'Rows in the fullest table' },
    { key: 'storage_bytes', label: 'Storage', bytes: true },
    { key: 'columns_per_table', label: 'Columns in the widest table' },
    { key: 'api_calls_per_month', label: 'API calls this month' },
    { key: 'url_sources', label: 'Tables imported from a URL' },
    { key: 'webhooks', label: 'Webhooks' },
    { key: 'views_per_table', label: 'Views on the busiest table' }
];

/**
 * One meter: its label, "used of cap" and how full it is (0 to 100). A null cap means no cap.
 * @param {{ key: string, label: string, bytes?: boolean }} row
 * @param {{ used: number, cap: number | null } | undefined} item
 */
export function meter(row, item) {
    const used = item ? item.used : 0;
    const cap = item ? item.cap : null;
    const fmt = row.bytes ? bytes_label : count_label;
    const percent =
        cap === null || cap <= 0
            ? 0
            : Math.min(100, Math.round((used / cap) * 100));
    return {
        key: row.key,
        label: row.label,
        text:
            cap === null
                ? `${fmt(used)} (no cap)`
                : `${fmt(used)} of ${fmt(cap)}`,
        percent,
        // Nearly full, then full: the meter's colour
        status:
            cap === null
                ? ''
                : used >= cap
                  ? 'exception'
                  : percent >= 80
                    ? 'warning'
                    : ''
    };
}

/**
 * The pricing page's rows: a label and each plan's value, from the plans' caps.
 * @param {Array<{ caps: any }>} plans
 */
export function pricing_rows(plans) {
    /** @param {(caps: any) => string} value */
    const row = (label, value) => ({
        label,
        values: plans.map(p => value(p.caps))
    });
    const schedules = caps =>
        caps.url_sync_schedules.includes('hourly') ? 'hourly' : 'daily only';
    return [
        row('Tables', c => count_label(c.tables)),
        row('Rows (all tables)', c => count_label(c.rows_per_account)),
        row('Rows per table', c => count_label(c.rows_per_table)),
        row('Storage', c => bytes_label(c.storage_bytes)),
        row('Columns per table', c => count_label(c.columns_per_table)),
        row('API calls per month', c => count_label(c.api_calls_per_month)),
        row(
            'API rate limit',
            c =>
                `${count_label(c.api_rate_per_second)}/s, bursts of ${count_label(c.api_rate_burst)}`
        ),
        row('Rows per API query page', c => count_label(c.query_page)),
        row('CSV upload size', c => bytes_label(c.csv_upload_bytes)),
        row(
            'Tables imported from a URL',
            c => `${count_label(c.url_sources)}, syncs ${schedules(c)}`
        ),
        row('Webhooks', c => count_label(c.webhooks)),
        row('Views per table', c => count_label(c.views_per_table)),
        row('History (audit log) kept', c => `${c.audit_keep_days} days`),
        row('Per-key rate limits and request logs', c =>
            c.key_limits_and_logs ? 'Yes' : '—'
        ),
        row('AI questions per month', c => count_label(c.ai.questions)),
        row('AI-generated rows per month', c => count_label(c.ai.rows))
    ];
}

/**
 * A plan's price: "$0" for Free, else "$9" (per month).
 * @param {{ price_month_usd: number | null }} plan
 */
export function price_label(plan) {
    return `$${plan.price_month_usd === null ? 0 : plan.price_month_usd}`;
}
