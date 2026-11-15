// Writes three made-up order CSVs of different sizes, for testing imports and big grids:
//   node examples/data/test/generate.mjs
// orders_small.csv (100 rows), orders_medium.csv (5,000) and orders_large.csv (50,000).
// The free plan allows 10,000 rows per table, so the large file also exercises that limit.
// A seeded random generator makes the output the same on every run. Everything is made up:
// emails use example.com and the products don't exist.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

// mulberry32: tiny seeded PRNG
const make_rand = seed => () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const first_names = [
    'Ava',
    'Ben',
    'Chloe',
    'Dev',
    'Elena',
    'Felix',
    'Grace',
    'Hiro',
    'Ines',
    'Jonah',
    'Kira',
    'Liam',
    'Maya',
    'Noah',
    'Olive',
    'Priya',
    'Quinn',
    'Rosa',
    'Sam',
    'Theo'
];
const last_names = [
    'Abbott',
    'Baker',
    'Chen',
    'Diaz',
    'Evans',
    'Fischer',
    'Garcia',
    'Hughes',
    'Ito',
    'Jensen',
    'Kowalski',
    'Lopez',
    'Moreau',
    'Nakamura',
    'Okafor',
    'Patel',
    'Reyes'
];
const products = [
    ['Desk Lamp', 'Home', 34.99],
    ['Wool Socks', 'Apparel', 12.5],
    ['Trail Backpack', 'Outdoor', 89],
    ['Ceramic Mug', 'Kitchen', 14.25],
    ['Notebook Set', 'Office', 9.99],
    ['Yoga Mat', 'Fitness', 29.95],
    ['Chef Knife', 'Kitchen', 64],
    ['Rain Jacket', 'Apparel', 119],
    ['Camp Stove', 'Outdoor', 54.75],
    ['Bookshelf', 'Home', 149],
    ['Desk Chair', 'Office', 219.99],
    ['Dumbbells', 'Fitness', 45.5]
];
const statuses = ['pending', 'paid', 'shipped', 'delivered', 'refunded'];
const regions = ['North', 'South', 'East', 'West', 'Central'];

const csv_cell = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);

function write(file, rows, seed) {
    const rand = make_rand(seed);
    const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
    const pick = list => list[Math.floor(rand() * list.length)];
    const start = Date.UTC(2025, 0, 1);
    const span = Date.UTC(2026, 10, 1) - start;

    const lines = [
        'order_id,order_date,customer,email,region,product,category,quantity,unit_price,total,status,gift'
    ];
    for (let i = 1; i <= rows; i++) {
        const first = pick(first_names);
        const last = pick(last_names);
        const [product, category, price] = pick(products);
        const quantity = int(1, 8);
        lines.push(
            [
                `ORD-${String(i).padStart(6, '0')}`,
                new Date(start + Math.floor(rand() * span)).toISOString().slice(0, 10),
                `${first} ${last}`,
                `${first}.${last}${int(1, 99)}@example.com`.toLowerCase(),
                pick(regions),
                product,
                category,
                quantity,
                price.toFixed(2),
                (price * quantity).toFixed(2),
                pick(statuses),
                rand() < 0.15
            ]
                .map(csv_cell)
                .join(',')
        );
    }
    fs.writeFileSync(path.join(dir, file), lines.join('\n') + '\n');
    console.log(`${file}: ${rows} rows`);
}

write('orders_small.csv', 100, 1);
write('orders_medium.csv', 5000, 2);
write('orders_large.csv', 50000, 3);
