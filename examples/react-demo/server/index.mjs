// Starts the support desk's server: `npm start` (after `npm run build`), or the Docker image.
// SIGUSR2 resets the data to the seed set now (`docker compose kill -s SIGUSR2 react-demo`).
import http from 'node:http';
import { createApp } from './app.mjs';
import { readConfig } from './config.mjs';
import { createInvokeDB } from './invokedb.mjs';
import { loadSeed, msUntilUtcHour, resetData } from './reset.mjs';

const config = readConfig();
const db = config.apiKey
  ? createInvokeDB({ baseUrl: config.invokedbUrl, apiKey: config.apiKey })
  : null;
if (!db) console.warn("INVOKEDB_API_KEY is not set: the app's API calls will answer 503");
if (!config.webhookSecret) {
  console.warn('INVOKEDB_WEBHOOK_SECRET is not set: webhook deliveries will be refused');
}

const app = createApp({
  basePath: config.basePath,
  db,
  webhookSecret: config.webhookSecret,
  staticDir: config.staticDir,
  trustProxy: config.trustProxy
});

async function reset(why) {
  if (!db) return;
  const started = Date.now();
  try {
    const counts = await app.whileResetting(() => resetData(db, loadSeed()));
    console.log(
      `Reset (${why}) in ${Date.now() - started} ms: ${counts.customers} customers, ` +
        `${counts.tickets} tickets, ${counts.comments} comments`
    );
  } catch (e) {
    console.error(`Reset (${why}) failed: ${e && e.message}`);
  }
}

function scheduleReset() {
  if (config.resetHourUtc === null || !Number.isInteger(config.resetHourUtc)) return;
  setTimeout(async () => {
    await reset('nightly');
    scheduleReset();
  }, msUntilUtcHour(config.resetHourUtc)).unref();
}
scheduleReset();
process.on('SIGUSR2', () => reset('on demand'));

const server = http.createServer(app.handler);
// Server-sent event streams stay open; only idle keep-alive sockets time out
server.requestTimeout = 0;
server.headersTimeout = 20_000;
server.listen(config.port, () => {
  console.log(`Support desk on http://127.0.0.1:${config.port}${config.basePath}/`);
});

const stop = () => {
  app.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
