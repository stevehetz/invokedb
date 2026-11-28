// The showcase set of a demo account (#333): a small company's linked tables, its saved views
// of every kind, a form, a filled AI column and a few edits for the history. Pure and
// deterministic (a seeded generator, dates relative to `now`), unit-tested in showcase.spec.ts;
// DemoSeedService (application/demo) makes it in a new demo account. All of it is invented:
// example.com emails and 555-01xx phone numbers.

export type ShowcaseTableKey = 'products' | 'customers' | 'orders' | 'events';
export type ShowcaseColumnType = 'string' | 'number' | 'date' | 'link';

export interface ShowcaseColumn {
    name: string;
    type: ShowcaseColumnType;
    // Link columns: the table linked to and the column of it shown for a row
    link_to?: ShowcaseTableKey;
    link_display?: string;
}

// A row by column name. A link cell is a list of row numbers (0-based) of the linked table,
// which the seed turns into row ids once that table's rows are made.
export type ShowcaseRow = Record<string, string | number | number[] | null>;

export interface ShowcaseTable {
    key: ShowcaseTableKey;
    name: string;
    columns: ShowcaseColumn[];
    rows: ShowcaseRow[];
}

// A saved view, with columns by name (the seed turns them into fields)
export interface ShowcaseView {
    table: ShowcaseTableKey;
    name: string;
    type: 'grid' | 'kanban' | 'chart' | 'calendar' | 'map';
    filters?: { column: string; type: string; value: string }[];
    sort?: { column: string; dir: 'asc' | 'desc' };
    kanban?: { group: string };
    chart?: { kind: 'bar' | 'line' | 'pie'; group: string; agg: 'count' | 'sum'; value?: string };
    calendar?: { date: string; title: string };
    map?: { lat: string; lng: string; label: string };
}

export interface ShowcaseForm {
    table: ShowcaseTableKey;
    title: string;
    description: string;
    fields: { column: string; required?: boolean }[];
}

// An AI column whose values are already in the rows (so it shows without spending AI)
export interface ShowcaseAiColumn {
    table: ShowcaseTableKey;
    column: string;
    prompt: string;
    inputs: string[];
}

// An edit made after the rows, so the history isn't only "rows added"
export interface ShowcaseEdit {
    table: ShowcaseTableKey;
    row: number;
    changes: Record<string, string | number>;
}

export interface Showcase {
    tables: ShowcaseTable[];
    views: ShowcaseView[];
    form: ShowcaseForm;
    ai_column: ShowcaseAiColumn;
    edits: ShowcaseEdit[];
}

export const SHOWCASE_SIZES = { products: 20, customers: 60, orders: 300, events: 40 };

const DAY = 24 * 60 * 60 * 1000;

// mulberry32: small and seeded, so every demo gets the same story (dates aside)
function generator(seed: number) {
    let a = seed >>> 0;
    const next = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
        next,
        int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
        pick: <T>(list: T[]): T => list[Math.floor(next() * list.length)]
    };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const iso_day = (t: number) => new Date(t).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

const FIRST_NAMES = [
    'Ada', 'Bram', 'Chiara', 'Dev', 'Elif', 'Femi', 'Greta', 'Hiro', 'Ines', 'Jonas',
    'Kemi', 'Liam', 'Mira', 'Noor', 'Oskar', 'Priya', 'Quinn', 'Rosa', 'Sami', 'Tess',
    'Uma', 'Viktor', 'Wen', 'Yara', 'Zane', 'Amara', 'Bodhi', 'Cleo', 'Dario', 'Esme'
]; // prettier-ignore
const LAST_NAMES = [
    'Fernsby', 'Okoro', 'Lund', 'Ramani', 'Kaya', 'Adeyemi', 'Holm', 'Tanaka', 'Moreau',
    'Berg', 'Mensah', 'Walsh', 'Novak', 'Haddad', 'Lindqvist', 'Iyer', 'Delaney', 'Ortiz',
    'Rahman', 'Quist'
]; // prettier-ignore

// Real places, so the map view lands on land
const CITIES: [string, number, number][] = [
    ['Seattle', 47.61, -122.33],
    ['Portland', 45.52, -122.68],
    ['San Francisco', 37.77, -122.42],
    ['Los Angeles', 34.05, -118.24],
    ['Denver', 39.74, -104.99],
    ['Austin', 30.27, -97.74],
    ['Chicago', 41.88, -87.63],
    ['Minneapolis', 44.98, -93.27],
    ['Atlanta', 33.75, -84.39],
    ['Miami', 25.76, -80.19],
    ['New York', 40.71, -74.01],
    ['Boston', 42.36, -71.06],
    ['Toronto', 43.65, -79.38],
    ['Montreal', 45.5, -73.57],
    ['London', 51.51, -0.13],
    ['Dublin', 53.35, -6.26],
    ['Amsterdam', 52.37, 4.9],
    ['Berlin', 52.52, 13.4],
    ['Stockholm', 59.33, 18.07],
    ['Lisbon', 38.72, -9.14]
];

type Segment = 'Retail' | 'Wholesale' | 'Enterprise';
const SEGMENT_NOTES: Record<Segment, string[]> = {
    Retail: [
        'Buys a few things at a time for home.',
        'Orders gifts around the holidays.',
        'Found us through a friend, small orders.',
        'Personal account, pays by card.'
    ],
    Wholesale: [
        'Runs a shop and restocks in bulk every month.',
        'Resells our products at weekend markets.',
        'Orders by the case for their cafe.',
        'Small store owner, asks for volume pricing.'
    ],
    Enterprise: [
        'Purchasing team at a large company, pays on invoice.',
        'Office supply contract for 300 staff.',
        'Corporate account with a yearly agreement.',
        'Buys for several regional offices.'
    ]
};
const SEGMENTS: Segment[] = ['Retail', 'Retail', 'Retail', 'Wholesale', 'Wholesale', 'Enterprise'];

const PRODUCTS: [string, string, number][] = [
    ['Oak Desk', 'Furniture', 420],
    ['Walnut Shelf', 'Furniture', 189],
    ['Task Chair', 'Furniture', 245],
    ['Standing Mat', 'Furniture', 59],
    ['Desk Lamp', 'Lighting', 48],
    ['Floor Lamp', 'Lighting', 129],
    ['LED Strip', 'Lighting', 24],
    ['Notebook Set', 'Stationery', 18],
    ['Fountain Pen', 'Stationery', 65],
    ['Sticky Notes', 'Stationery', 6],
    ['Desk Organizer', 'Stationery', 32],
    ['Ceramic Mug', 'Kitchen', 14],
    ['Pour-over Kettle', 'Kitchen', 72],
    ['Coffee Grinder', 'Kitchen', 98],
    ['Water Bottle', 'Kitchen', 22],
    ['Wireless Mouse', 'Tech', 39],
    ['Mechanical Keyboard', 'Tech', 149],
    ['USB-C Hub', 'Tech', 55],
    ['Monitor Arm', 'Tech', 110],
    ['Noise-cancelling Headphones', 'Tech', 299]
];

export const ORDER_STATUSES = ['New', 'Packed', 'Shipped', 'Delivered', 'Cancelled'];

const EVENT_TYPES: [string, string][] = [
    ['Delivery', 'Warehouse'],
    ['Customer call', 'Phone'],
    ['Product demo', 'Showroom'],
    ['Webinar', 'Online'],
    ['Stock count', 'Warehouse'],
    ['Team meeting', 'Office']
];
const OWNERS = ['Ada', 'Bram', 'Chiara', 'Dev', 'Elif'];

function products_table(): ShowcaseTable {
    const g = generator(11);
    return {
        key: 'products',
        name: 'products',
        columns: [
            { name: 'Name', type: 'string' },
            { name: 'Category', type: 'string' },
            { name: 'Price', type: 'number' },
            { name: 'In stock', type: 'number' }
        ],
        rows: PRODUCTS.map(([name, category, price]) => ({
            Name: name,
            Category: category,
            Price: price,
            'In stock': g.int(0, 120)
        }))
    };
}

function customers_table(now: number): ShowcaseTable {
    const g = generator(23);
    const rows: ShowcaseRow[] = [];
    const used = new Set<string>();
    for (let i = 0; i < SHOWCASE_SIZES.customers; i++) {
        let first: string;
        let last: string;
        do {
            first = g.pick(FIRST_NAMES);
            last = g.pick(LAST_NAMES);
        } while (used.has(`${first} ${last}`));
        used.add(`${first} ${last}`);
        const [city, lat, lng] = g.pick(CITIES);
        const segment = g.pick(SEGMENTS);
        rows.push({
            Name: `${first} ${last}`,
            Email: `${first}.${last}@example.com`.toLowerCase(),
            // 555-0100 to 555-0199 are the numbers kept for fiction
            Phone: `+1 202-555-01${pad(i % 100)}`,
            City: city,
            Latitude: round2(lat + (g.next() - 0.5) * 0.1),
            Longitude: round2(lng + (g.next() - 0.5) * 0.1),
            'Customer since': iso_day(now - g.int(30, 900) * DAY),
            Notes: g.pick(SEGMENT_NOTES[segment]),
            Segment: segment
        });
    }
    return {
        key: 'customers',
        name: 'customers',
        columns: [
            { name: 'Name', type: 'string' },
            { name: 'Email', type: 'string' },
            { name: 'Phone', type: 'string' },
            { name: 'City', type: 'string' },
            { name: 'Latitude', type: 'number' },
            { name: 'Longitude', type: 'number' },
            { name: 'Customer since', type: 'date' },
            { name: 'Notes', type: 'string' },
            { name: 'Segment', type: 'string' }
        ],
        rows
    };
}

// The newer an order, the earlier its status
function order_status(age_days: number, roll: number) {
    if (roll < 0.05) return 'Cancelled';
    if (age_days < 3) return roll < 0.6 ? 'New' : 'Packed';
    if (age_days < 8) return roll < 0.3 ? 'Packed' : 'Shipped';
    if (age_days < 15) return roll < 0.5 ? 'Shipped' : 'Delivered';
    return 'Delivered';
}

function orders_table(now: number): ShowcaseTable {
    const g = generator(37);
    const rows: ShowcaseRow[] = [];
    // Oldest first, so the row order is the order they came in
    const ages = Array.from({ length: SHOWCASE_SIZES.orders }, () => g.int(0, 179)).sort(
        (a, b) => b - a
    );
    ages.forEach((age, i) => {
        const product = g.int(0, PRODUCTS.length - 1);
        const quantity = g.int(1, PRODUCTS[product][2] > 200 ? 3 : 8);
        const day = now - age * DAY;
        rows.push({
            Order: `ORD-${1001 + i}`,
            Customer: [g.int(0, SHOWCASE_SIZES.customers - 1)],
            Product: [product],
            Quantity: quantity,
            Total: round2(PRODUCTS[product][2] * quantity),
            Status: order_status(age, g.next()),
            Ordered: iso_day(day),
            Month: iso_day(day).slice(0, 7)
        });
    });
    return {
        key: 'orders',
        name: 'orders',
        columns: [
            { name: 'Order', type: 'string' },
            { name: 'Customer', type: 'link', link_to: 'customers', link_display: 'Name' },
            { name: 'Product', type: 'link', link_to: 'products', link_display: 'Name' },
            { name: 'Quantity', type: 'number' },
            { name: 'Total', type: 'number' },
            { name: 'Status', type: 'string' },
            { name: 'Ordered', type: 'date' },
            { name: 'Month', type: 'string' }
        ],
        rows
    };
}

function events_table(now: number): ShowcaseTable {
    const g = generator(53);
    const rows: ShowcaseRow[] = [];
    const days = Array.from({ length: SHOWCASE_SIZES.events }, () => g.int(-20, 40)).sort(
        (a, b) => a - b
    );
    days.forEach(offset => {
        const [type, location] = g.pick(EVENT_TYPES);
        const owner = g.pick(OWNERS);
        const subject =
            type === 'Delivery'
                ? `Delivery from ${g.pick(['Northwind', 'Acme Freight', 'Blue Harbor'])}`
                : type === 'Customer call'
                  ? `Call with ${g.pick(FIRST_NAMES)} ${g.pick(LAST_NAMES)}`
                  : type === 'Product demo'
                    ? `${g.pick(PRODUCTS)[0]} demo`
                    : type;
        rows.push({
            Title: subject,
            Date: iso_day(now + offset * DAY),
            Type: type,
            Location: location,
            Owner: owner
        });
    });
    return {
        key: 'events',
        name: 'events',
        columns: [
            { name: 'Title', type: 'string' },
            { name: 'Date', type: 'date' },
            { name: 'Type', type: 'string' },
            { name: 'Location', type: 'string' },
            { name: 'Owner', type: 'string' }
        ],
        rows
    };
}

/** The whole showcase for a demo account made at `now`. Linked tables come before their links. */
export function build_showcase(now: number): Showcase {
    return {
        tables: [products_table(), customers_table(now), orders_table(now), events_table(now)],
        views: [
            {
                table: 'orders',
                name: 'Orders by status',
                type: 'kanban',
                kanban: { group: 'Status' }
            },
            {
                table: 'orders',
                name: 'Revenue by month',
                type: 'chart',
                chart: { kind: 'bar', group: 'Month', agg: 'sum', value: 'Total' }
            },
            {
                table: 'orders',
                name: 'Big orders',
                type: 'grid',
                filters: [{ column: 'Total', type: 'greaterThan', value: '400' }],
                sort: { column: 'Total', dir: 'desc' }
            },
            {
                table: 'events',
                name: 'Event calendar',
                type: 'calendar',
                calendar: { date: 'Date', title: 'Title' }
            },
            {
                table: 'customers',
                name: 'Customer map',
                type: 'map',
                map: { lat: 'Latitude', lng: 'Longitude', label: 'Name' }
            }
        ],
        form: {
            table: 'customers',
            title: 'Join our customer list',
            description: 'Leave your details and we will be in touch.',
            fields: [
                { column: 'Name', required: true },
                { column: 'Email', required: true },
                { column: 'Phone' },
                { column: 'City' },
                { column: 'Notes' }
            ]
        },
        ai_column: {
            table: 'customers',
            column: 'Segment',
            prompt: 'From the notes, is this customer Retail, Wholesale or Enterprise? Answer with one of the three words.',
            inputs: ['Notes']
        },
        edits: [
            { table: 'orders', row: SHOWCASE_SIZES.orders - 1, changes: { Status: 'Packed' } },
            { table: 'orders', row: SHOWCASE_SIZES.orders - 2, changes: { Status: 'Shipped' } },
            { table: 'products', row: 4, changes: { Price: 52 } }
        ]
    };
}
