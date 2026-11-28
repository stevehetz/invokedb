// The server's settings, from the environment (deploy/compose.yaml sets them from prod.env).

export function readConfig(env = process.env) {
  const basePath = (env.BASE_PATH ?? '/react-demo').replace(/\/+$/, '');
  return {
    port: Number(env.PORT || 8080),
    basePath,
    // The account's /api/v1. In production the compose network's http://api:8001/api/v1.
    invokedbUrl: env.INVOKEDB_BASE_URL || 'http://127.0.0.1:8001/api/v1',
    // The demo account's read-write key for its three tables, and the webhook's secret
    // (setup.mjs prints both). Without a key the API answers 503; without a secret every
    // webhook delivery is refused.
    apiKey: env.INVOKEDB_API_KEY || '',
    webhookSecret: env.INVOKEDB_WEBHOOK_SECRET || '',
    // Nightly reset to the seed data, at this hour UTC; "off" turns it off
    resetHourUtc: env.RESET_HOUR_UTC === 'off' ? null : Number(env.RESET_HOUR_UTC ?? 4),
    // Behind Caddy: take the client's IP from X-Forwarded-For
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    staticDir: env.STATIC_DIR || new URL('../dist', import.meta.url).pathname
  };
}
