// Writes seed.json next to this file: the support desk's customers, tickets and comments.
//   node examples/react-demo/seed/generate.mjs
// Customers come from examples/data/contacts.csv (invented people); tickets and comments are
// made up from the word lists below with a seeded random generator, so the output is the same
// on every run. Times are offsets (minutes before the reset), so the data always looks recent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

// mulberry32: tiny seeded PRNG (the same one examples/data/generate.mjs uses)
let seed = 20261128;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pick = list => list[Math.floor(rand() * list.length)];

// A small CSV reader: enough for contacts.csv (quoted cells, no newlines inside them)
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const split = line => {
    const cells = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        cells.push(cur);
        cur = '';
      } else cur += ch;
    }
    cells.push(cur);
    return cells;
  };
  const header = split(lines[0]);
  return lines.slice(1).map(line => {
    const cells = split(line);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  });
}

const contacts = parseCsv(
  fs.readFileSync(path.join(dir, '..', '..', 'data', 'contacts.csv'), 'utf8')
);
const customers = contacts.slice(0, 40).map(c => ({
  name: `${c.first_name} ${c.last_name}`,
  email: c.email,
  phone: c.phone,
  city: c.city,
  state: c.state
}));

const STATUSES = ['open', 'in_progress', 'waiting', 'closed'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const AGENTS = ['Robin (support)', 'Casey (support)', 'Morgan (support)'];

const subjects = [
  [
    'Can’t sign in after password reset',
    'I reset my password this morning but the new one is refused on the sign-in page.'
  ],
  [
    'Invoice shows the wrong billing address',
    'The last invoice still has our old office address on it.'
  ],
  [
    'Export to CSV is missing columns',
    'When I export the orders table, the notes column is not in the file.'
  ],
  [
    'Mobile app crashes on startup',
    'Since the latest update the app closes right after the splash screen.'
  ],
  [
    'Request: dark mode for reports',
    'Our team works late and would love a dark theme on the reports page.'
  ],
  [
    'Charged twice this month',
    'My card statement shows two charges for the same subscription period.'
  ],
  ['Webhook deliveries are delayed', 'Our endpoint gets events several minutes after the change.'],
  [
    'How do I add a team member?',
    'I would like a colleague to see our tables. Where is that setting?'
  ],
  [
    'Search doesn’t find accented names',
    'Searching for "Jose" does not find "José" in the customers table.'
  ],
  [
    'Order confirmation email never arrived',
    'A customer placed an order yesterday and got no confirmation.'
  ],
  [
    'Import fails on a large spreadsheet',
    'Uploading a 40 MB spreadsheet stops at 80% with an error.'
  ],
  ['Change the account owner', 'Our previous admin left; please move ownership to me.'],
  [
    'API returns 429 during nightly sync',
    'Our sync job hits rate limits around 2 a.m. every night.'
  ],
  [
    'Dashboard numbers don’t match the table',
    'The total on the dashboard is lower than the sum of the rows.'
  ],
  ['Cancel my subscription', 'We are closing the shop at the end of the month.'],
  ['Time zone is wrong on timestamps', 'Created times show up four hours ahead of our local time.'],
  ['Feature request: recurring tasks', 'It would help to repeat a task every week automatically.'],
  ['Shipping label prints blank', 'The label PDF opens but the page is empty.'],
  ['Two-factor codes not accepted', 'The six-digit codes from my authenticator app are rejected.'],
  ['Need a copy of last year’s invoices', 'Our accountant asked for every invoice from last year.']
];

const agentReplies = [
  'Thanks for reaching out! I’m looking into this now.',
  'Could you send a screenshot of what you see?',
  'I was able to reproduce this on our side and passed it to the team.',
  'A fix is rolling out today; please try again in an hour.',
  'I’ve updated your account. Let me know if anything still looks off.',
  'Which browser and version are you using?',
  'That setting is under Account → Team. I’ve linked the help article.',
  'I’ve refunded the duplicate charge; it should appear in 3–5 days.'
];
const customerReplies = [
  'Thanks, that worked!',
  'Still seeing the same problem, unfortunately.',
  'Here’s the screenshot you asked for.',
  'Chrome, latest version, on a Mac.',
  'Any update on this?',
  'Great, appreciate the quick help.',
  'It happens every time I try.'
];

const tickets = [];
const comments = [];
for (let i = 0; i < 60; i++) {
  const [title, description] = pick(subjects);
  const customer = pick(customers);
  // Older tickets are more likely to be closed
  const createdAgo = int(30, 60 * 24 * 21);
  const status = createdAgo > 60 * 24 * 10 && rand() < 0.7 ? 'closed' : pick(STATUSES);
  const ticket = {
    number: 1001 + i,
    title,
    description,
    status,
    priority: pick(PRIORITIES),
    created_minutes_ago: createdAgo,
    customer_email: customer.email
  };
  tickets.push(ticket);
  const n = int(0, 4);
  let at = createdAgo;
  for (let j = 0; j < n; j++) {
    at = Math.max(1, at - int(10, Math.max(11, Math.floor(at / 2))));
    const fromAgent = j % 2 === 0;
    comments.push({
      ticket_number: ticket.number,
      body: fromAgent ? pick(agentReplies) : pick(customerReplies),
      author: fromAgent ? pick(AGENTS) : customer.name,
      created_minutes_ago: at
    });
  }
}

fs.writeFileSync(
  path.join(dir, 'seed.json'),
  JSON.stringify({ customers, tickets, comments }, null, 2) + '\n'
);
console.log(
  `wrote seed.json (${customers.length} customers, ${tickets.length} tickets, ${comments.length} comments)`
);
