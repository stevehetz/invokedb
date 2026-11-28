import { ORDER_STATUSES, SHOWCASE_SIZES, build_showcase } from './showcase';
import { DEMO_CAPS } from '../plan/plans';
import { WebFileManager } from '../web-file/web-file.manager';
import { parse_utc_date } from '../date';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 28, 12);

describe('the demo showcase (#333)', () => {
    const showcase = build_showcase(NOW);
    const table = (key: string) => showcase.tables.find(t => t.key === key);

    it('is the same story every time', () => {
        expect(build_showcase(NOW)).toEqual(showcase);
    });

    it('has linked tables of a few hundred rows, within the demo caps', () => {
        expect(showcase.tables.map(t => t.key)).toEqual([
            'products',
            'customers',
            'orders',
            'events'
        ]);
        showcase.tables.forEach(t => {
            expect(t.rows.length).toBe(SHOWCASE_SIZES[t.key]);
            expect(t.rows.length).toBeLessThanOrEqual(DEMO_CAPS.rows_per_table);
            expect(t.columns.length).toBeLessThanOrEqual(DEMO_CAPS.columns_per_table);
        });
        const total = showcase.tables.reduce((n, t) => n + t.rows.length, 0);
        expect(total).toBeGreaterThanOrEqual(300);
        expect(total).toBeLessThanOrEqual(DEMO_CAPS.rows_per_account / 2);
        expect(showcase.tables.length).toBeLessThan(DEMO_CAPS.tables);
        const types = new Set(showcase.tables.flatMap(t => t.columns.map(c => c.type)));
        expect([...types].sort()).toEqual(['date', 'link', 'number', 'string']);
    });

    it('has column names the grid accepts', () => {
        showcase.tables.forEach(t => {
            const seen: { headerName: string }[] = [];
            t.columns.forEach(c => {
                expect(() =>
                    WebFileManager.prototype.validate_column_header.call({}, seen, c.name)
                ).not.toThrow();
                seen.push({ headerName: c.name });
            });
        });
    });

    it('fills every cell with a value of its column type', () => {
        showcase.tables.forEach(t => {
            t.rows.forEach(row => {
                expect(Object.keys(row).sort()).toEqual(t.columns.map(c => c.name).sort());
                t.columns.forEach(c => {
                    const v = row[c.name];
                    if (c.type === 'number') expect(Number.isFinite(v)).toBe(true);
                    if (c.type === 'string') expect(typeof v).toBe('string');
                    if (c.type === 'date') {
                        expect(isNaN(parse_utc_date(v as string).getTime())).toBe(false);
                    }
                    if (c.type === 'link') {
                        const target = table(c.link_to);
                        expect(target.columns.some(x => x.name === c.link_display)).toBe(true);
                        // Linked tables are made first
                        expect(showcase.tables.indexOf(target)).toBeLessThan(
                            showcase.tables.indexOf(t)
                        );
                        (v as number[]).forEach(n => {
                            expect(Number.isInteger(n)).toBe(true);
                            expect(n).toBeGreaterThanOrEqual(0);
                            expect(n).toBeLessThan(target.rows.length);
                        });
                    }
                });
            });
        });
    });

    it('is made up: example.com emails and 555-01xx phones', () => {
        const customers = table('customers').rows;
        customers.forEach(c => {
            expect(c.Email).toMatch(/^[a-z]+\.[a-z]+@example\.com$/);
            expect(c.Phone).toMatch(/^\+1 202-555-01\d\d$/);
            expect(c.Latitude).toBeGreaterThanOrEqual(-90);
            expect(c.Latitude).toBeLessThanOrEqual(90);
            expect(c.Longitude).toBeGreaterThanOrEqual(-180);
            expect(c.Longitude).toBeLessThanOrEqual(180);
        });
        expect(new Set(customers.map(c => c.Email)).size).toBe(customers.length);
    });

    it('has orders over the last months, by status and month', () => {
        const orders = table('orders').rows;
        orders.forEach(o => {
            expect(ORDER_STATUSES).toContain(o.Status);
            expect(o.Month).toBe((o.Ordered as string).slice(0, 7));
            const t = parse_utc_date(o.Ordered as string).getTime();
            expect(t).toBeLessThanOrEqual(NOW);
            expect(t).toBeGreaterThan(NOW - 181 * DAY);
        });
        expect(new Set(orders.map(o => o.Status)).size).toBeGreaterThanOrEqual(4);
        expect(new Set(orders.map(o => o.Month)).size).toBeGreaterThanOrEqual(5);
    });

    it('has events around now, so this month of the calendar has some', () => {
        const month = new Date(NOW).toISOString().slice(0, 7);
        const events = table('events').rows;
        expect(events.some(e => (e.Date as string).startsWith(month))).toBe(true);
    });

    it('has a view of each kind, a form, an AI column and edits on its own columns', () => {
        expect(showcase.views.map(v => v.type).sort()).toEqual([
            'calendar',
            'chart',
            'grid',
            'kanban',
            'map'
        ]);
        const columns_of = (key: string) => table(key).columns.map(c => c.name);
        showcase.views.forEach(v => {
            const names = [
                ...(v.filters || []).map(f => f.column),
                ...(v.sort ? [v.sort.column] : []),
                ...(v.kanban ? [v.kanban.group] : []),
                ...(v.chart ? [v.chart.group, v.chart.value].filter(Boolean) : []),
                ...(v.calendar ? [v.calendar.date, v.calendar.title] : []),
                ...(v.map ? [v.map.lat, v.map.lng, v.map.label] : [])
            ];
            names.forEach(n => expect(columns_of(v.table)).toContain(n));
        });
        showcase.form.fields.forEach(f =>
            expect(columns_of(showcase.form.table)).toContain(f.column)
        );
        const ai = showcase.ai_column;
        expect(columns_of(ai.table)).toContain(ai.column);
        ai.inputs.forEach(n => expect(columns_of(ai.table)).toContain(n));
        expect(ai.inputs).not.toContain(ai.column);
        // Its values are there already
        table(ai.table).rows.forEach(r => expect(typeof r[ai.column]).toBe('string'));
        expect(showcase.edits.length).toBeGreaterThan(0);
        showcase.edits.forEach(e => {
            expect(e.row).toBeLessThan(table(e.table).rows.length);
            Object.keys(e.changes).forEach(n => expect(columns_of(e.table)).toContain(n));
            // Not the AI column's inputs, which would make its cells stale
            if (e.table === ai.table)
                ai.inputs.forEach(n => expect(e.changes).not.toHaveProperty(n));
        });
    });
});
