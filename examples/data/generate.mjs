// Writes the example CSVs (todo.csv, contacts.csv, wine_reviews.csv) next to this file:
//   node examples/data/generate.mjs
// Every value is made up from the word lists below, using a seeded random generator, so the
// output is the same on every run. Phone numbers use the fictional 555-01xx range, emails use
// example.com, and the wineries and wines don't exist.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

// mulberry32: tiny seeded PRNG
let seed = 20261115;
const rand = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pick = list => list[Math.floor(rand() * list.length)];
const pad = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const dateBetween = (from, to) => {
    const a = Date.UTC(...from);
    const b = Date.UTC(...to);
    return isoDate(new Date(a + Math.floor(rand() * (b - a))));
};

const csvCell = v => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const writeCsv = (name, columns, rows) => {
    const lines = [columns.join(',')];
    rows.forEach(r => lines.push(columns.map(c => csvCell(r[c])).join(',')));
    fs.writeFileSync(path.join(dir, name), lines.join('\n') + '\n');
    console.log(`wrote ${name} (${rows.length} rows)`);
};

// ---- todo.csv ----
const tasks = [
    'Renew car registration',
    'Book dentist appointment',
    'Water the garden',
    'Call the plumber about the kitchen sink',
    'Pick up dry cleaning',
    'Plan weekend hike',
    'Back up laptop',
    'Pay electricity bill',
    'Order birthday gift for Sam',
    'Clean out the garage',
    'Schedule oil change',
    'Return library books',
    'Buy groceries for the week',
    'Write thank-you notes',
    'Replace smoke detector batteries',
    'Update resume',
    'Research new phone plans',
    'Fix the squeaky door hinge',
    'Sort out photo backups',
    'Meal prep for Monday',
    'Cancel unused streaming subscription',
    'Organize the bookshelf',
    'Send invoice to client',
    'Try the new bread recipe'
];
const todos = tasks.map(name => ({
    name,
    is_complete: rand() < 0.35 ? 'yes' : 'no',
    priority: pick(['low', 'medium', 'medium', 'high']),
    due_date: dateBetween([2026, 10, 10], [2027, 0, 31])
}));
writeCsv('todo.csv', ['name', 'is_complete', 'priority', 'due_date'], todos);

// ---- contacts.csv ----
const firstNames = [
    'Avery',
    'Jordan',
    'Riley',
    'Morgan',
    'Casey',
    'Quinn',
    'Harper',
    'Rowan',
    'Elliot',
    'Sage',
    'Parker',
    'Reese',
    'Emerson',
    'Finley',
    'Hayden',
    'Dakota',
    'Skyler',
    'Kendall',
    'Logan',
    'Marlowe',
    'Nico',
    'Oakley',
    'Peyton',
    'Remy',
    'Tatum',
    'Wren',
    'Jules',
    'Arden',
    'Blair',
    'Corey',
    'Devon',
    'Ellis',
    'Frankie',
    'Gray',
    'Indie',
    'Jesse',
    'Kai',
    'Lane',
    'Micah',
    'Noel'
];
const lastNames = [
    'Abernathy',
    'Bellweather',
    'Calloway',
    'Dunmore',
    'Eastwick',
    'Fairbanks',
    'Garrity',
    'Hollister',
    'Ingram',
    'Jarvis',
    'Kettering',
    'Lockridge',
    'Merriweather',
    'Northcott',
    'Oakhurst',
    'Pemberton',
    'Quimby',
    'Ravensworth',
    'Stanhope',
    'Thornbury',
    'Underhill',
    'Vandermeer',
    'Whitlock',
    'Yardley',
    'Ashcombe',
    'Brightwater',
    'Coldwell',
    'Dashwood',
    'Ellsworth',
    'Fenwick'
];
const streets = [
    'Maple',
    'Cedar',
    'Birch',
    'Willow',
    'Juniper',
    'Aspen',
    'Hawthorn',
    'Larkspur',
    'Meadow',
    'Orchard',
    'Ridge',
    'Brook',
    'Summit',
    'Harbor',
    'Lantern',
    'Foxglove'
];
const streetTypes = ['St', 'Ave', 'Rd', 'Ln', 'Dr', 'Ct', 'Way', 'Pl'];
const cities = [
    ['Portland', 'OR'],
    ['Boise', 'ID'],
    ['Denver', 'CO'],
    ['Austin', 'TX'],
    ['Madison', 'WI'],
    ['Raleigh', 'NC'],
    ['Tucson', 'AZ'],
    ['Burlington', 'VT'],
    ['Savannah', 'GA'],
    ['Spokane', 'WA'],
    ['Omaha', 'NE'],
    ['Providence', 'RI'],
    ['Asheville', 'NC'],
    ['Santa Fe', 'NM'],
    ['Ann Arbor', 'MI'],
    ['Duluth', 'MN'],
    ['Bend', 'OR'],
    ['Fresno', 'CA']
];
const usedEmails = new Set();
const contacts = [];
for (let i = 0; i < 120; i++) {
    const first_name = pick(firstNames);
    const last_name = pick(lastNames);
    let email = `${first_name}.${last_name}`.toLowerCase();
    for (let n = 2; usedEmails.has(email); n++)
        email = `${first_name}.${last_name}${n}`.toLowerCase();
    usedEmails.add(email);
    const [city, state] = pick(cities);
    contacts.push({
        first_name,
        last_name,
        dob: dateBetween([1950, 0, 1], [2004, 11, 31]),
        email: `${email}@example.com`,
        phone: `(${int(200, 989)}) 555-01${pad(int(0, 99))}`,
        address: `${int(10, 9899)} ${pick(streets)} ${pick(streetTypes)}`,
        city,
        state
    });
}
writeCsv(
    'contacts.csv',
    ['first_name', 'last_name', 'dob', 'email', 'phone', 'address', 'city', 'state'],
    contacts
);

// ---- wine_reviews.csv ----
const regions = {
    'United States': [
        'Willamette Valley',
        'Sonoma Coast',
        'Paso Robles',
        'Columbia Valley',
        'Finger Lakes'
    ],
    France: ['Loire Valley', 'Rhône Valley', 'Languedoc', 'Alsace', 'Burgundy'],
    Italy: ['Tuscany', 'Piedmont', 'Sicily', 'Veneto', 'Abruzzo'],
    Spain: ['Rioja', 'Ribera del Duero', 'Priorat', 'Rías Baixas'],
    Portugal: ['Douro', 'Dão', 'Alentejo'],
    Argentina: ['Mendoza', 'Salta', 'Patagonia'],
    Chile: ['Maipo Valley', 'Colchagua Valley', 'Casablanca Valley'],
    Australia: ['Barossa Valley', 'Margaret River', 'Clare Valley'],
    'New Zealand': ['Marlborough', 'Central Otago', "Hawke's Bay"],
    'South Africa': ['Stellenbosch', 'Swartland', 'Elgin'],
    Germany: ['Mosel', 'Rheingau', 'Pfalz'],
    Austria: ['Wachau', 'Kamptal', 'Burgenland']
};
// Grapes each country is known for, so the varieties fit the regions
const varieties = {
    'United States': {
        red: ['Pinot Noir', 'Cabernet Sauvignon', 'Zinfandel', 'Merlot', 'Syrah'],
        white: ['Chardonnay', 'Riesling', 'Sauvignon Blanc']
    },
    France: {
        red: ['Pinot Noir', 'Syrah', 'Grenache', 'Cabernet Franc', 'Red Blend'],
        white: ['Chenin Blanc', 'Riesling', 'Chardonnay', 'Viognier', 'Gewürztraminer']
    },
    Italy: {
        red: ['Sangiovese', 'Nebbiolo', "Nero d'Avola", 'Barbera', 'Montepulciano'],
        white: ['Pinot Grigio', 'Vermentino', 'Garganega']
    },
    Spain: { red: ['Tempranillo', 'Garnacha', 'Red Blend'], white: ['Albariño', 'Verdejo'] },
    Portugal: { red: ['Touriga Nacional', 'Red Blend'], white: ['Encruzado', 'White Blend'] },
    Argentina: {
        red: ['Malbec', 'Cabernet Sauvignon', 'Bonarda'],
        white: ['Torrontés', 'Chardonnay']
    },
    Chile: {
        red: ['Carménère', 'Cabernet Sauvignon', 'Syrah'],
        white: ['Sauvignon Blanc', 'Chardonnay']
    },
    Australia: {
        red: ['Shiraz', 'Cabernet Sauvignon', 'Grenache'],
        white: ['Riesling', 'Chardonnay', 'Semillon']
    },
    'New Zealand': {
        red: ['Pinot Noir', 'Syrah'],
        white: ['Sauvignon Blanc', 'Pinot Gris', 'Chardonnay']
    },
    'South Africa': {
        red: ['Pinotage', 'Syrah', 'Cabernet Sauvignon'],
        white: ['Chenin Blanc', 'Sauvignon Blanc']
    },
    Germany: { red: ['Spätburgunder'], white: ['Riesling', 'Silvaner', 'Weissburgunder'] },
    Austria: { red: ['Blaufränkisch', 'Zweigelt'], white: ['Grüner Veltliner', 'Riesling'] }
};
const wineryA = [
    'Cedar',
    'Stone',
    'Silver',
    'Fox',
    'Raven',
    'Copper',
    'Hollow',
    'Lark',
    'Granite',
    'Willow',
    'Ember',
    'Juniper',
    'Quarry',
    'Saltmarsh',
    'Thistle',
    'Bramble',
    'Tidewater',
    'Moonfield'
];
const wineryB = [
    'Hill',
    'Creek',
    'Ridge',
    'Hollow',
    'Bend',
    'Gate',
    'Field',
    'Terrace',
    'Crossing',
    'Bluff'
];
const wineryC = ['Cellars', 'Vineyards', 'Estate', 'Wine Co.', 'Family Wines', 'Winery'];
const wineries = [];
while (wineries.length < 40) {
    const w = `${pick(wineryA)} ${pick(wineryB)} ${pick(wineryC)}`;
    if (!wineries.includes(w)) wineries.push(w);
}
const cuvees = [
    'Reserve',
    'Estate',
    'Old Vine',
    'Single Vineyard',
    'Barrel Select',
    "Founder's",
    'Hillside',
    'Limited Release',
    'Classic',
    'Northern Slope'
];
const notes = {
    red: [
        'black cherry',
        'plum',
        'blackberry',
        'raspberry',
        'dried cranberry',
        'cassis',
        'cocoa',
        'tobacco leaf',
        'cedar',
        'clove',
        'violet',
        'black pepper',
        'espresso',
        'leather',
        'baking spice'
    ],
    white: [
        'green apple',
        'pear',
        'lemon zest',
        'grapefruit',
        'white peach',
        'apricot',
        'honeysuckle',
        'wet stone',
        'toasted almond',
        'brioche',
        'lime blossom',
        'pineapple',
        'chamomile'
    ],
    rosé: ['strawberry', 'watermelon', 'rose petal', 'blood orange', 'red currant', 'white pepper']
};
const bodies = [
    'Light-bodied',
    'Medium-bodied',
    'Full-bodied',
    'Elegant',
    'Lush',
    'Bright',
    'Structured',
    'Supple'
];
const finishes = [
    'a long, savory finish',
    'fine-grained tannins',
    'crisp acidity',
    'a touch of oak on the finish',
    'a mineral edge',
    'a clean, refreshing close',
    'velvety texture',
    'lingering spice'
];
const verdicts = [
    'Drink now.',
    'Drink now through 2030.',
    'Best from 2028.',
    'A great value.',
    'Pair with grilled lamb.',
    'Pair with roast chicken.',
    'Pair with oysters.',
    'Pair with mushroom risotto.',
    'Pair with aged cheddar.'
];
const wines = [];
for (let i = 0; i < 300; i++) {
    const country = pick(Object.keys(regions));
    const region = pick(regions[country]);
    const color = rand() < 0.5 ? 'red' : rand() < 0.85 ? 'white' : 'rosé';
    const variety = color === 'rosé' ? 'Rosé' : pick(varieties[country][color]);
    const winery = pick(wineries);
    const vintage = int(2012, 2024);
    const points = Math.min(
        100,
        Math.max(80, Math.round(88 + (rand() + rand() + rand() - 1.5) * 6))
    );
    const base = (points - 79) ** 1.6 * (0.6 + rand());
    const price = Math.max(9, Math.round(base + int(8, 20)));
    const [n1, n2, n3] = [...notes[color]].sort(() => rand() - 0.5);
    wines.push({
        title: `${winery} ${vintage} ${pick(cuvees)} ${variety} (${region})`,
        winery,
        variety,
        country,
        region,
        vintage,
        price,
        points,
        description: `${pick(bodies)}, with aromas of ${n1} and ${n2} leading to a palate of ${n3}, and ${pick(finishes)}. ${pick(verdicts)}`
    });
}
writeCsv(
    'wine_reviews.csv',
    [
        'title',
        'winery',
        'variety',
        'country',
        'region',
        'vintage',
        'price',
        'points',
        'description'
    ],
    wines
);
