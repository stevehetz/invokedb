const os = require('os');
const crypto = require('crypto');
process.env.NODE_ENV = process.env.ENV;
process.env.TZ = 'UTC';

const date = new Date();
let server_name = os.hostname();
if (process.env.IS_LOCAL) {
    server_name += `_${date.getTime()}`;
}

// Shared secret that backend processes use to register with the websocket broker as trusted
// ("secure") clients. Locally every role runs in one process, so a random per-process token
// works when it isn't set. Elsewhere it must be set, to the same value for every process.
let ws_server_token = process.env.HORIZON_WS_SERVER_TOKEN;
if (!ws_server_token && process.env.IS_LOCAL) {
    ws_server_token = crypto.randomUUID();
}

const env = {
    IS_LOCAL: process.env.IS_LOCAL,
    SERVER_NAME: server_name,
    IS_HORIZON_BE: process.env.IS_HORIZON_BE,
    IS_HORIZON_PRC: process.env.IS_HORIZON_PRC,
    IS_HORIZON_SB: process.env.IS_HORIZON_SB,
    IS_HORIZON_FS: process.env.IS_HORIZON_FS,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    SUPPORT_EMAIL: process.env.SUPPORT_EMAIL,
    HORIZON_SB_PRIV_WS_PORT: process.env.HORIZON_SB_PRIV_WS_PORT,
    HORIZON_SB_PRIV_WS_URL: process.env.HORIZON_SB_PRIV_WS_URL,
    HORIZON_WS_SERVER_TOKEN: ws_server_token,
    HORIZON_FE_PUB_HTTP_URL: process.env.HORIZON_FE_PUB_HTTP_URL,
    // The backend's public URL; the Google and GitHub sign-in callbacks are under it
    HORIZON_BE_PUB_HTTP_URL: process.env.HORIZON_BE_PUB_HTTP_URL,
    // Optional. Google / GitHub sign-in is turned on when its client ID and secret are both set.
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    // Encrypts each account's two-factor (TOTP) secret (#214), e.g. `openssl rand -hex 32`.
    // Unset: nobody can turn two-factor sign-in on (locally a fixed development key is used).
    // Changing it breaks the authenticator apps already set up; recovery codes still work.
    HORIZON_TOTP_KEY: process.env.HORIZON_TOTP_KEY,
    HORIZON_FILE_SHARE: process.env.HORIZON_FILE_SHARE,
    HORIZON_BE_PRIV_HTTP_PORT: process.env.HORIZON_BE_PRIV_HTTP_PORT,
    HORIZON_POSTGRES_HOST: process.env.HORIZON_POSTGRES_HOST,
    HORIZON_POSTGRES_PORT: process.env.HORIZON_POSTGRES_PORT,
    HORIZON_POSTGRES_DB: process.env.HORIZON_POSTGRES_DB,
    HORIZON_POSTGRES_USERNAME: process.env.HORIZON_POSTGRES_USERNAME,
    HORIZON_POSTGRES_PASSWORD: process.env.HORIZON_POSTGRES_PASSWORD,
    HORIZON_MONGO_URI: process.env.HORIZON_MONGO_URI,
    HORIZON_MONGO_DB: process.env.HORIZON_MONGO_DB,
    HORIZON_MONGO_TRACKING_URI: process.env.HORIZON_MONGO_TRACKING_URI,
    HORIZON_MONGO_TRACKING_DB: process.env.HORIZON_MONGO_TRACKING_DB,
    MAILGUN_API_KEY: process.env.MAILGUN_API_KEY,
    MAILGUN_DN: process.env.MAILGUN_DN,
    // Test only (scripts/smoke-env.sh sets it): webhook receivers ("127.0.0.1:8199,...") that are
    // allowed although they're private addresses (#140). Never set it in production.
    HORIZON_WEBHOOK_TEST_HOSTS: process.env.HORIZON_WEBHOOK_TEST_HOSTS,
    // Test only (scripts/smoke-env.sh sets it): puts accounts on a plan by email with shrunken
    // caps, `{"demo7@invokedb.com": {"plan": "FREE", "caps": {"tables": 2}}}` (#183). Read by
    // core/plan/plans.ts. Never set it in production.
    HORIZON_TEST_PLANS: process.env.HORIZON_TEST_PLANS,
    // The no-signup demo (#333): how many demo accounts may be live at once (default 50, in
    // core/demo/demo.ts). Read by DemoService on each new demo; smoke-env.sh sets 4.
    HORIZON_DEMO_MAX_LIVE: process.env.HORIZON_DEMO_MAX_LIVE,
    // Optional. The AI features (#149) are on when it and HORIZON_AI_MONTHLY_BUDGET_USD are set;
    // the key stays on the backend.
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    // Test only (scripts/smoke-env.sh sets it to api-smoke.mjs's stub of the Anthropic API)
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
    // Optional: the Claude model for the AI features (default in core/ai/ai-plan.ts)
    HORIZON_AI_MODEL: process.env.HORIZON_AI_MODEL,
    // What the AI features may cost the whole server per UTC month, in US dollars
    // (docs/PRICING.md 3.5). Unset: the AI features are off.
    HORIZON_AI_MONTHLY_BUDGET_USD: process.env.HORIZON_AI_MONTHLY_BUDGET_USD,
    // Billing through Stripe (#129, docs/OPERATIONS.md "Stripe"): the secret API key (`sk_test_...`
    // locally, `sk_live_...` in production) and the webhook endpoint's signing secret (`whsec_...`).
    // Billing is on when both are set; without them the upgrade buttons are hidden and the
    // billing routes answer 503. The prices are found by their lookup keys (core/billing).
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    // Test only (scripts/smoke-env.sh sets it to api-smoke.mjs's stub of the Stripe API,
    // "http://127.0.0.1:8196"). Never set it in production.
    STRIPE_API_BASE: process.env.STRIPE_API_BASE,
    // The admin area (#277): a comma-separated allowlist of the admins' emails. Each one also
    // needs a verified email and two-factor sign-in on. Unset or empty: nobody is an admin.
    HORIZON_ADMIN_EMAILS: process.env.HORIZON_ADMIN_EMAILS
};

export default env;
