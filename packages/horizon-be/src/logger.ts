const { createLogger, format, transports } = require('winston');
const SlackHook = require('winston-slack-webhook-transport');
const Postgres = require('@pauleliet/winston-pg-native');
import * as moment from 'moment';
import env from '@app/env';

const _m: any = moment;
_m.suppressDeprecationWarnings = true;

let logger;
let logger_format;
const logger_transports = [];

const pad_level = level => {
    level = `${level}:`.trim();
    const length = 16;
    const to_add = length - level.length;
    for (let i = 0; i < to_add; i++) {
        level = level + ' ';
    }
    return level;
};

if (env.IS_LOCAL) {
    logger_format = format.combine(
        format.splat(),
        format.colorize(),
        format.timestamp(),
        format.align(),
        format.printf(data => {
            const message = data.message && data.message.trim ? data.message.trim() : data.message;
            return `${data.timestamp} ${pad_level(data.level)} ${message}`;
        })
    );
    logger_transports.push(
        new transports.Console({
            level: 'debug',
            json: false,
            colorize: false
        })
    );
} else {
    logger_format = format.combine(format.splat(), format.timestamp(), format.align());
    logger_transports.push(
        new transports.Console({
            level: 'debug',
            json: false,
            colorize: false,
            format: format.combine(
                format.splat(),
                format.timestamp(),
                format.align(),
                format.printf(data => {
                    const message =
                        data.message && data.message.trim ? data.message.trim() : data.message;
                    const datetime = moment(data.timestamp).format('YYYY-MM-DD HH:mm:ss');
                    return `${datetime}: ${data.level} - ${message}`;
                })
            )
        })
    );
    logger_transports.push(
        new SlackHook({
            level: env.SLACK_LOG_LEVEL,
            webhookUrl: env.SLACK_WEBHOOK_URL,
            formatter: data => {
                const message =
                    data.message && data.message.trim ? data.message.trim() : data.message;
                return {
                    text: message || ' '
                };
            }
        })
    );

    logger_transports.push(
        new Postgres({
            connectionString: `postgres://${env.HORIZON_POSTGRES_USERNAME}:${env.HORIZON_POSTGRES_PASSWORD}@${env.HORIZON_POSTGRES_HOST}:${env.HORIZON_POSTGRES_PORT}/horizon_logs`,
            level: env.POSTGRES_LOG_LEVEL,
            tableName: 'log'
        })
    );
}

logger = createLogger({
    format: logger_format,
    transports: logger_transports
});

export default logger;
