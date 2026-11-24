const { createLogger, format, transports } = require('winston');
import env from '@app/env';
import { format_date } from '@app/core/date';

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
                    const datetime = format_date(new Date(data.timestamp), 'YYYY-MM-DD HH:mm:ss');
                    return `${datetime}: ${data.level} - ${message}`;
                })
            )
        })
    );
}

logger = createLogger({
    format: logger_format,
    transports: logger_transports
});

export default logger;
