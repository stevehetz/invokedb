import {
    BadRequestException,
    Injectable,
    NotFoundException,
    OnModuleDestroy
} from '@nestjs/common';
import { ErrorTrackingManager } from '@app/core/error-tracking/error-tracking.manager';
import {
    ALERTS_PER_HOUR,
    ErrorEvent,
    ErrorReportError,
    CapGroup,
    alert_text,
    cap_group,
    client_event,
    parse_error_query,
    server_event
} from '@app/core/error-tracking/error-tracking';
import { set_error_reporter } from '@app/core/error-tracking/report';
import { send_telegram, telegram_configured } from '@app/core/telegram/telegram';
import env from '@app/env';
import logger from '@app/logger';

const HOUR = 60 * 60 * 1000;

// Error tracking (#212): records the backend's unhandled errors (through report_error, which
// this service backs) and the frontend's reports, and tells the owner on Telegram when a new
// one appears. Recording never throws: a failure is only logged.
@Injectable()
export class ErrorTrackingService implements OnModuleDestroy {
    // This process's alerts in the current hour per cap group, so a flood of new errors can't
    // spam the chat, and frontend reports can't use up the backend's budget
    private alerts: Record<CapGroup, { hour_start: number; sent: number }> = {
        backend: { hour_start: 0, sent: 0 },
        frontend: { hour_start: 0, sent: 0 }
    };

    constructor(private readonly manager: ErrorTrackingManager) {
        set_error_reporter((source, ex, context) => this.record(server_event(source, ex, context)));
    }

    onModuleDestroy() {
        set_error_reporter(null);
    }

    // The clock and Telegram, replaceable in tests
    now: () => number = () => Date.now();
    notify: (text: string) => Promise<void> = async text => {
        if (telegram_configured()) await send_telegram(text);
    };

    async record(event: ErrorEvent) {
        try {
            const now = this.now();
            const res = await this.manager.record(event, now);
            if (res.is_new && res.stored) await this.alert(res.id, event, now);
        } catch (ex) {
            logger.warn(`Error tracking: not recorded: ${ex && ex.message}`);
        }
    }

    /** A report from the frontend (`POST /errors`). */
    async record_client(body: any, user_agent: unknown, account_id: number | null) {
        let event: ErrorEvent;
        try {
            event = client_event(body, user_agent, account_id);
        } catch (ex) {
            if (ex instanceof ErrorReportError) throw new BadRequestException(ex.message);
            throw ex;
        }
        await this.record(event);
        return { recorded: true };
    }

    async list(query: any) {
        let q;
        try {
            q = parse_error_query(query);
        } catch (ex) {
            if (ex instanceof ErrorReportError) throw new BadRequestException(ex.message);
            throw ex;
        }
        return await this.manager.list(q);
    }

    async get(id: string) {
        const error = await this.manager.get(id);
        if (!error) throw new NotFoundException('Error not found');
        return error;
    }

    private async alert(id: string, event: ErrorEvent, now: number) {
        const group = cap_group(event.source);
        if (now - this.alerts[group].hour_start >= HOUR) {
            this.alerts[group] = { hour_start: now, sent: 0 };
        }
        const budget = this.alerts[group];
        if (budget.sent >= ALERTS_PER_HOUR[group]) return;
        if (!(await this.manager.claim_alert(id, now))) return;
        budget.sent++;
        const url = env.HORIZON_FE_PUB_HTTP_URL
            ? `${env.HORIZON_FE_PUB_HTTP_URL}/app/admin?error=${id}`
            : null;
        try {
            await this.notify(alert_text(event, url));
        } catch (ex) {
            logger.warn(`Error tracking: alert not sent: ${ex && ex.message}`);
        }
    }
}
