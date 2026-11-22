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
    ENV: process.env.ENV,
    SERVER_NAME: server_name,
    IS_HORIZON_BE: process.env.IS_HORIZON_BE,
    IS_HORIZON_PRC: process.env.IS_HORIZON_PRC,
    IS_HORIZON_SB: process.env.IS_HORIZON_SB,
    IS_HORIZON_FS: process.env.IS_HORIZON_FS,
    POSTGRES_LOG_LEVEL: process.env.POSTGRES_LOG_LEVEL,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    HORIZON_FS_PRIV_HTTP_PORT: process.env.HORIZON_FS_PRIV_HTTP_PORT,
    HORIZON_FS_PRIV_HTTP_URL: process.env.HORIZON_FS_PRIV_HTTP_URL,
    HORIZON_SB_PRIV_WS_PORT: process.env.HORIZON_SB_PRIV_WS_PORT,
    HORIZON_SB_PRIV_WS_URL: process.env.HORIZON_SB_PRIV_WS_URL,
    HORIZON_WS_SERVER_TOKEN: ws_server_token,
    HORIZON_FE_PUB_HTTP_URL: process.env.HORIZON_FE_PUB_HTTP_URL,
    HORIZON_FILE_SHARE: process.env.HORIZON_FILE_SHARE,
    HORIZON_BE_PRIV_HTTP_PORT: process.env.HORIZON_BE_PRIV_HTTP_PORT,
    HORIZON_PRC_PRIV_HTTP_PORT: process.env.HORIZON_PRC_PRIV_HTTP_PORT,
    HORIZON_POSTGRES_HOST: process.env.HORIZON_POSTGRES_HOST,
    HORIZON_POSTGRES_PORT: process.env.HORIZON_POSTGRES_PORT,
    HORIZON_POSTGRES_DB: process.env.HORIZON_POSTGRES_DB,
    HORIZON_POSTGRES_USERNAME: process.env.HORIZON_POSTGRES_USERNAME,
    HORIZON_POSTGRES_PASSWORD: process.env.HORIZON_POSTGRES_PASSWORD,
    HORIZON_MONGO_URI: process.env.HORIZON_MONGO_URI,
    HORIZON_MONGO_DB: process.env.HORIZON_MONGO_DB,
    HORIZON_MONGO_TRACKING_URI: process.env.HORIZON_MONGO_TRACKING_URI,
    HORIZON_MONGO_TRACKING_DB: process.env.HORIZON_MONGO_TRACKING_DB,
    MAILGUN_IP_ADDRESS: process.env.MAILGUN_IP_ADDRESS,
    MAILGUN_SMTP_HOSTNAME: process.env.MAILGUN_SMTP_HOSTNAME,
    MAILGUN_SMTP_LOGIN: process.env.MAILGUN_SMTP_LOGIN,
    MAILGUN_API_KEY: process.env.MAILGUN_API_KEY,
    MAILGUN_PW: process.env.MAILGUN_PW,
    MAILGUN_API_URL: process.env.MAILGUN_API_URL,
    MAILGUN_DN: process.env.MAILGUN_DN
};

export default env;
