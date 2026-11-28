// Resets the demo's tables to the seed data now, without the server: `npm run reset`, with
// INVOKEDB_API_KEY (and INVOKEDB_BASE_URL) set. Against a running server, prefer SIGUSR2 (see
// index.mjs): it keeps the browsers' activity feed quiet during the reset.
import { readConfig } from './config.mjs';
import { createInvokeDB } from './invokedb.mjs';
import { loadSeed, resetData } from './reset.mjs';

const config = readConfig();
if (!config.apiKey) {
  console.error('Set INVOKEDB_API_KEY (and INVOKEDB_BASE_URL) first');
  process.exit(1);
}
const db = createInvokeDB({ baseUrl: config.invokedbUrl, apiKey: config.apiKey });
const counts = await resetData(db, loadSeed());
console.log(
  `Reset ${config.invokedbUrl}: ${counts.customers} customers, ${counts.tickets} tickets, ` +
    `${counts.comments} comments`
);
