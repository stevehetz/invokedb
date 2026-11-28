import {
    CARD_WIDTH,
    HEADER_HEIGHT,
    MAX_COLUMNS_SHOWN,
    MAX_GRID_COLUMNS,
    ROW_HEIGHT,
    build_schema_diagram,
    folder_and_subfolders,
    layout_order,
    linked_only_ids,
    one_hop_ids,
    pairs_touching,
    picked_table_ids,
    table_folder_id,
    view_order,
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

const sorted = (ids: Iterable<number>) => [...ids].sort((a, b) => a - b);

describe('schema diagram folders (#376)', () => {
    const folders = [
        { id: 10, name: 'Sales', parent_id: null },
        { id: 11, name: 'Archive', parent_id: 10 },
        { id: 12, name: 'Old', parent_id: 11 },
        { id: 20, name: 'Ops', parent_id: null }
    ];

    it('finds a folder and its subfolders at any depth, without looping on a cycle', () => {
        expect(sorted(folder_and_subfolders(folders, 10))).toEqual([10, 11, 12]);
        expect(sorted(folder_and_subfolders(folders, 11))).toEqual([11, 12]);
        expect(sorted(folder_and_subfolders(folders, 20))).toEqual([20]);
        expect(sorted(folder_and_subfolders(folders, 99))).toEqual([]);
        const cycle = [
            { id: 1, name: 'a', parent_id: 2 },
            { id: 2, name: 'b', parent_id: 1 }
        ];
        expect(sorted(folder_and_subfolders(cycle, 1))).toEqual([1, 2]);
    });

    it('treats no parent, 0 and a folder that is gone as the top level', () => {
        const live = new Set([10]);
        expect(table_folder_id(null, live)).toBeNull();
        expect(table_folder_id(undefined, live)).toBeNull();
        expect(table_folder_id(0, live)).toBeNull();
        expect(table_folder_id(99, live)).toBeNull();
        expect(table_folder_id(10, live)).toBe(10);
    });

    it("picks a folder's tables with its subfolders', or the unfiled ones", () => {
        const tables = [
            { id: 1, parent_id: 10 },
            { id: 2, parent_id: 12 },
            { id: 3, parent_id: 20 },
            { id: 4, parent_id: null },
            { id: 5, parent_id: 0 },
            { id: 6, parent_id: 99 }
        ];
        expect(sorted(picked_table_ids(tables, folders, 10))).toEqual([1, 2]);
        expect(sorted(picked_table_ids(tables, folders, 11))).toEqual([2]);
        expect(sorted(picked_table_ids(tables, folders, 'unfiled'))).toEqual([4, 5, 6]);
    });

    it('goes one hop in both directions, never two', () => {
        const picked = new Set([1]);
        const pairs = [
            { from: 1, to: 2 }, // picked → 2
            { from: 3, to: 1 }, // 3 → picked
            { from: 2, to: 4 }, // a second hop: not taken
            { from: 1, to: 1 }
        ];
        expect(sorted(one_hop_ids(picked, pairs))).toEqual([2, 3]);
        expect(pairs_touching(pairs, picked)).toHaveLength(3);
    });

    it('keeps only tables with an arrow for "only linked tables"', () => {
        const shown = new Set([1, 2, 3, 4]);
        const out = linked_only_ids(shown, [
            { from: 1, to: 2 },
            { from: 3, to: 3 },
            { from: 4, to: 9 } // 9 isn't shown, so no arrow is drawn
        ]);
        expect(sorted(out)).toEqual([1, 2, 3]);
    });

    it('lays out the outside tables after the folder ones', () => {
        const tables = [
            { id: 1, name: 'a-outside' },
            { id: 2, name: 'z-own' },
            { id: 3, name: 'b-own' }
        ];
        expect(view_order(tables, new Set([1]), [[1, 2]])).toEqual([3, 2, 1]);
    });

    const input = [
        { id: 1, name: 'Customers', parent_id: 10, columns: [col('a', 'Name', 0)] },
        {
            id: 2,
            name: 'Orders',
            parent_id: 10,
            columns: [link('b', 'Customer', 0, 1), col('c', 'Product Id', 1)]
        },
        { id: 3, name: 'Products', parent_id: 20, columns: [col('a', 'Title', 0)] },
        // Links into Sales from the top level
        { id: 4, name: 'Invoices', parent_id: null, columns: [link('o', 'Order', 0, 2)] },
        // Two hops from Sales (through Products): never drawn with Sales
        { id: 5, name: 'Suppliers', parent_id: 20, columns: [link('p', 'Product', 0, 3)] },
        // Links two of Sales' outside tables: that arrow isn't drawn with Sales
        { id: 6, name: 'Notes', parent_id: 20, columns: [link('i', 'Invoice', 0, 4)] },
        { id: 7, name: 'Loose', parent_id: null, columns: [col('a', 'A', 0)] }
    ];

    it('answers every table as before with no folder, and lists the folders', () => {
        const before = build_schema_diagram(
            input.map(t => ({ id: t.id, name: t.name, columns: t.columns }))
        );
        const d = build_schema_diagram(input, { folders });
        expect(d.tables.map(t => [t.id, t.x, t.y])).toEqual(
            before.tables.map(t => [t.id, t.x, t.y])
        );
        expect(d.links).toEqual(before.links);
        expect(d.suggestions).toEqual(before.suggestions);
        expect([d.width, d.height]).toEqual([before.width, before.height]);
        expect(d.tables.every(t => t.outside === false)).toBe(true);
        expect(d.tables.find(t => t.id === 1).folder_name).toBe('Sales');
        expect(d.tables.find(t => t.id === 4).folder_name).toBeNull();
        expect(d.folders.map(f => f.name)).toEqual(['Archive', 'Old', 'Ops', 'Sales']);
        expect(before.folders).toEqual([]);
    });

    it('draws a folder with the tables one hop away, marked and last', () => {
        const d = build_schema_diagram(input, { folders, folder: 10 });
        expect(d.tables.map(t => t.id)).toEqual([1, 2, 4, 3]);
        expect(d.tables.filter(t => t.outside).map(t => t.id)).toEqual([4, 3]);
        expect(d.tables.find(t => t.id === 3).folder_name).toBe('Ops');
        expect(d.tables.find(t => t.id === 4).folder_name).toBeNull();
        // The link from Invoices comes in; Notes → Invoices (both outside) isn't drawn
        expect(d.links.map(l => [l.from_table_id, l.to_table_id])).toEqual([
            [2, 1],
            [4, 2]
        ]);
        expect(d.suggestions.map(l => [l.from_table_id, l.to_table_id])).toEqual([[2, 3]]);
    });

    it('draws the unfiled tables, and hides cards with no arrow when asked', () => {
        const d = build_schema_diagram(input, { folders, folder: 'unfiled' });
        expect(d.tables.map(t => t.id)).toEqual([4, 7, 6, 2]);
        expect(d.tables.filter(t => t.outside).map(t => t.id)).toEqual([6, 2]);
        const linked = build_schema_diagram(input, {
            folders,
            folder: 'unfiled',
            linked_only: true
        });
        expect(sorted(linked.tables.map(t => t.id))).toEqual([2, 4, 6]);
        const all_linked = build_schema_diagram(input, { folders, linked_only: true });
        expect(sorted(all_linked.tables.map(t => t.id))).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('answers no tables for a folder with none', () => {
        const d = build_schema_diagram(input, { folders, folder: 11 });
        expect(d.tables).toEqual([]);
        expect(d.links).toEqual([]);
        expect(d.folders).toHaveLength(4);
    });
});
