// What `GET /usage` answers (#183): the account's plan, each counted cap with how much of it is
// used, and per table the numbers behind the per-table caps. Pure (no I/O), unit-tested in
// usage.spec.ts; UsageService gathers the numbers.
import { AccountPlan, quota_month, usage_item } from './plans';

export interface TableUsage {
    id: number;
    name: string;
    rows: number;
    columns: number;
    views: number;
}

export interface UsageInput {
    plan: AccountPlan;
    now: number;
    tables: TableUsage[];
    storage_bytes: number;
    api_calls: number;
    url_sources: number;
    webhooks: number;
}

const max = (values: number[]) => values.reduce((m, v) => Math.max(m, v), 0);

export function build_usage(input: UsageInput) {
    const { plan, tables } = input;
    const caps = plan.caps;
    const fin = (n: number) => (Number.isFinite(n) ? n : null);
    return {
        plan: { id: plan.plan.id, name: plan.plan.name },
        // An internal account (core/plan/plans.ts) has no counted caps: each `cap` is null
        internal: plan.internal,
        // The API quota's period (UTC); it starts again on the 1st
        month: quota_month(input.now),
        usage: {
            tables: usage_item(tables.length, caps.tables),
            rows_per_account: usage_item(
                tables.reduce((sum, t) => sum + t.rows, 0),
                caps.rows_per_account
            ),
            // The fullest table's
            rows_per_table: usage_item(max(tables.map(t => t.rows)), caps.rows_per_table),
            storage_bytes: usage_item(input.storage_bytes, caps.storage_bytes),
            columns_per_table: usage_item(max(tables.map(t => t.columns)), caps.columns_per_table),
            api_calls_per_month: usage_item(input.api_calls, caps.api_calls_per_month),
            url_sources: usage_item(input.url_sources, caps.url_sources),
            webhooks: usage_item(input.webhooks, caps.webhooks),
            views_per_table: usage_item(max(tables.map(t => t.views)), caps.views_per_table)
        },
        tables: tables.map(t => ({
            id: t.id,
            name: t.name,
            rows: t.rows,
            columns: t.columns,
            views: t.views
        })),
        // The caps that aren't counts
        limits: {
            api_rate_per_second: fin(caps.api_rate_per_second),
            api_rate_burst: fin(caps.api_rate_burst),
            rows_per_write: caps.rows_per_write,
            query_page: caps.query_page,
            csv_upload_bytes: caps.csv_upload_bytes,
            url_sync_schedules: caps.url_sync_schedules,
            audit_keep_days: caps.audit_keep_days,
            key_limits_and_logs: caps.key_limits_and_logs
        }
    };
}
