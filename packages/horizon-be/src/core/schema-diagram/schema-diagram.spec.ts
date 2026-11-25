import {
    CARD_WIDTH,
    HEADER_HEIGHT,
    MAX_COLUMNS_SHOWN,
    MAX_GRID_COLUMNS,
    ROW_HEIGHT,
    build_schema_diagram,
    layout_order,
    normalize_name,
    schema_columns,
    suggested_target,
    table_name_forms
} from './schema-diagram';

const col = (field: string, headerName: string, order: number, extra: any = {}) => ({
    field,
    headerName,
    order,
    col_type: 'string',
    ...extra
});

const link = (field: string, headerName: string, order: number, table: number) =>
    col(field, headerName, order, { col_type: 'link', link_table_id: table });

describe('schema diagram names', () => {
    it('normalizes names', () => {
        expect(normalize_name('Customer_ID')).toBe('customerid');
        expect(normalize_name(' Order Items ')).toBe('orderitems');
    });

    it('knows the singular of a table name', () => {
        expect(table_name_forms('Customers')).toEqual(['customers', 'customer']);
        expect(table_name_forms('Categories')).toContain('category');
        expect(table_name_forms('Addresses')).toContain('address');
        expect(table_name_forms('Address')).toEqual(['address']);
        expect(table_name_forms('')).toEqual([]);
    });

    it('suggests the table a "<table> id" column names', () => {
        const tables = [
            { id: 1, name: 'Customers' },
            { id: 2, name: 'orders' },
            { id: 3, name: 'Categories' }
        ];
        expect(suggested_target('Customer Id', 2, tables)).toBe(1);
        expect(suggested_target('customer_id', 2, tables)).toBe(1);
        expect(suggested_target('CustomersID', 2, tables)).toBe(1);
        expect(suggested_target('category_id', 2, tables)).toBe(3);
        // Not its own table, not "id" alone, not a column that isn't an id
        expect(suggested_target('Order Id', 2, tables)).toBeNull();
        expect(suggested_target('id', 2, tables)).toBeNull();
        expect(suggested_target('Customer', 2, tables)).toBeNull();
        expect(suggested_target('Supplier Id', 2, tables)).toBeNull();
    });

    it("doesn't guess between two tables with the same name", () => {
        const tables = [
            { id: 1, name: 'order' },
            { id: 2, name: 'Orders' },
            { id: 3, name: 'items' }
        ];
        expect(suggested_target('order_id', 3, tables)).toBeNull();
    });
});

describe('schema_columns', () => {
    it('keeps named columns in order, with their types and links', () => {
        const cols = schema_columns([
            col('b', 'Second', 2, { col_type: 'number' }),
            col('x', '', 0),
            col('d', 'Gone', 1, { deleted: true }),
            link('c', 'Owner', 3, 7),
            { field: 'a', headerName: 'First', order: 1 }
        ]);
        expect(cols).toEqual([
            { field: 'a', name: 'First', type: 'string' },
            { field: 'b', name: 'Second', type: 'number' },
            { field: 'c', name: 'Owner', type: 'link', link_table_id: 7 }
        ]);
    });
});

describe('layout_order', () => {
    it('puts linked tables together, most connected first, lone tables last by name', () => {
        const tables = [
            { id: 1, name: 'zeta' },
            { id: 2, name: 'alpha' },
            { id: 3, name: 'hub' },
            { id: 4, name: 'beta' },
            { id: 5, name: 'pair-a' },
            { id: 6, name: 'pair-b' }
        ];
        const order = layout_order(tables, [
            [1, 3],
            [4, 3],
            [5, 6],
            [3, 3]
        ]);
        expect(order).toEqual([3, 4, 1, 5, 6, 2]);
    });
});

describe('build_schema_diagram', () => {
    it('draws every table, its link columns and suggestions', () => {
        const d = build_schema_diagram([
            { id: 1, name: 'Customers', columns: [col('a', 'Name', 0)] },
            {
                id: 2,
                name: 'Orders',
                columns: [
                    col('a', 'Total', 0, { col_type: 'number' }),
                    link('b', 'Customer', 1, 1),
                    col('c', 'Product Id', 2)
                ]
            },
            { id: 3, name: 'Products', columns: [col('a', 'Title', 0)] },
            // A link to a table that's gone isn't drawn
            { id: 4, name: 'Notes', columns: [link('a', 'About', 0, 99)] }
        ]);
        expect(d.tables.map(t => t.id).sort()).toEqual([1, 2, 3, 4]);
        expect(d.links).toHaveLength(1);
        expect(d.links[0]).toMatchObject({
            from_table_id: 2,
            from_field: 'b',
            to_table_id: 1,
            suggested: false
        });
        expect(d.suggestions).toHaveLength(1);
        expect(d.suggestions[0]).toMatchObject({
            from_table_id: 2,
            from_field: 'c',
            to_table_id: 3,
            suggested: true
        });
        // The linked group comes first, starting with the most connected table
        expect(d.tables[0].id).toBe(2);
    });

    it("doesn't suggest a link that already exists", () => {
        const d = build_schema_diagram([
            { id: 1, name: 'Customers', columns: [col('a', 'Name', 0)] },
            {
                id: 2,
                name: 'Orders',
                columns: [link('b', 'Customer', 0, 1), col('c', 'Customer Id', 1)]
            }
        ]);
        expect(d.links).toHaveLength(1);
        expect(d.suggestions).toHaveLength(0);
    });

    it('anchors arrows on the column row and the linked header', () => {
        const d = build_schema_diagram([
            { id: 1, name: 'a', columns: [col('x', 'X', 0)] },
            { id: 2, name: 'b', columns: [col('y', 'Y', 0), link('z', 'Z', 1, 1)] }
        ]);
        const from = d.tables.find(t => t.id === 2);
        const to = d.tables.find(t => t.id === 1);
        const e = d.links[0];
        expect(e.y1).toBe(from.y + HEADER_HEIGHT + ROW_HEIGHT * 1.5);
        expect(e.y2).toBe(to.y + HEADER_HEIGHT / 2);
        if (to.x > from.x) {
            expect([e.from_side, e.to_side]).toEqual(['right', 'left']);
            expect(e.x1).toBe(from.x + CARD_WIDTH);
            expect(e.x2).toBe(to.x);
        } else {
            expect([e.from_side, e.to_side]).toEqual(['left', 'right']);
            expect(e.x1).toBe(from.x);
            expect(e.x2).toBe(to.x + CARD_WIDTH);
        }
    });

    it('draws a link to its own table back on the right', () => {
        const d = build_schema_diagram([
            { id: 1, name: 'People', columns: [col('a', 'Name', 0), link('m', 'Manager', 1, 1)] }
        ]);
        expect(d.links[0]).toMatchObject({ from_side: 'right', to_side: 'right' });
        expect(d.width).toBeGreaterThan(d.links[0].x1);
    });

    it('keeps 20 tables readable: no overlapping cards, a bounded grid', () => {
        const input = Array.from({ length: 20 }, (_, i) => ({
            id: i + 1,
            name: `table${i + 1}`,
            columns: Array.from({ length: (i % 7) + 1 }, (_, j) => col(`f${j}`, `Col ${j}`, j))
        }));
        // A chain of links through all of them
        for (let i = 1; i < 20; i++) input[i].columns.push(link('l', 'Prev', 99, i));
        const d = build_schema_diagram(input);
        expect(d.tables).toHaveLength(20);
        expect(d.links).toHaveLength(19);
        const xs = new Set(d.tables.map(t => t.x));
        expect(xs.size).toBeLessThanOrEqual(MAX_GRID_COLUMNS);
        for (const a of d.tables) {
            expect(a.x + a.width).toBeLessThanOrEqual(d.width);
            expect(a.y + a.height).toBeLessThanOrEqual(d.height);
            for (const b of d.tables) {
                if (a === b) continue;
                const apart =
                    a.x + a.width <= b.x ||
                    b.x + b.width <= a.x ||
                    a.y + a.height <= b.y ||
                    b.y + b.height <= a.y;
                expect(apart).toBe(true);
            }
        }
    });

    it('caps the columns on a card but always shows linked ones', () => {
        const columns = Array.from({ length: 20 }, (_, j) => col(`f${j}`, `Col ${j}`, j));
        columns.push(link('l', 'Owner', 30, 2));
        const d = build_schema_diagram([
            { id: 1, name: 'wide', columns },
            { id: 2, name: 'owners', columns: [col('a', 'Name', 0)] }
        ]);
        const wide = d.tables.find(t => t.id === 1);
        expect(wide.columns).toHaveLength(MAX_COLUMNS_SHOWN);
        expect(wide.columns.some(c => c.field === 'l')).toBe(true);
        expect(wide.hidden_columns).toBe(21 - MAX_COLUMNS_SHOWN);
        expect(wide.height).toBe(HEADER_HEIGHT + (MAX_COLUMNS_SHOWN + 1) * ROW_HEIGHT + 6);
    });

    it('answers an empty diagram for an account with no tables', () => {
        const d = build_schema_diagram([]);
        expect(d.tables).toEqual([]);
        expect(d.links).toEqual([]);
        expect(d.width).toBeGreaterThan(0);
    });
});
