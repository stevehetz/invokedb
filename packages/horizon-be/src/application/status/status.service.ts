import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StatusManager } from '@app/core/status/status.manager';
import {
    Check,
    HEARTBEAT_EVERY_MS,
    IncidentError,
    STATUS_CACHE_MS,
    api_check,
    database_check,
    e2e_check,
    overall_status,
    parse_incident,
    processor_check
} from '@app/core/status/status';
import { AdminService } from '../admin/admin.service';
import env from '@app/env';
import logger from '@app/logger';

const ROUND_TRIP_TIMEOUT_MS = 5000;

// The public status page (#212): our own checks, answered by the API at GET /status. The
// processor role writes a heartbeat every HEARTBEAT_EVERY_MS; the API reads it.
@Injectable()
export class StatusService {
    private cache: { at: number; checks: Check[] } | null = null;
    private pending: Promise<Check[]> | null = null;

    constructor(
        private readonly data_source: DataSource,
        private readonly status_manager: StatusManager,
        private readonly admin_service: AdminService
    ) {
        if (env.IS_HORIZON_PRC) {
            setInterval(() => this.beat(), HEARTBEAT_EVERY_MS);
            setTimeout(() => this.beat(), 1000);
        }
    }

    now: () => number = () => Date.now();

    private async beat() {
        try {
            await this.status_manager.beat(env.SERVER_NAME, this.now());
        } catch (ex) {
            logger.warn(`Status: heartbeat not written: ${ex && ex.message}`);
        }
    }

    /** The page's answer. `websocket_ready` is this API process's own readiness (/health). */
    async status(websocket_ready: boolean) {
        const now = this.now();
        const checks = [api_check(websocket_ready), ...(await this.cached_checks(now))];
        let incident = null;
        try {
            incident = await this.status_manager.incident();
        } catch (ex) {
            logger.warn(`Status: incident not read: ${ex && ex.message}`);
        }
        return {
            status: overall_status(checks, incident),
            checks,
            incident,
            checked_at: this.cache?.at ?? now
        };
    }

    async set_incident(body: any) {
        let note;
        try {
            note = parse_incident(body);
        } catch (ex) {
            if (ex instanceof IncidentError) throw new BadRequestException(ex.message);
            throw ex;
        }
        await this.status_manager.set_incident(note.message, note.level, this.now());
        logger.info(`Status: incident note set (${note.level})`);
        return { incident: await this.status_manager.incident() };
    }

    async clear_incident() {
        await this.status_manager.clear_incident();
        logger.info('Status: incident note cleared');
        return { incident: null };
    }

    // The checks other than the API's own, built at most every STATUS_CACHE_MS (one at a time)
    private async cached_checks(now: number): Promise<Check[]> {
        if (this.cache && now - this.cache.at < STATUS_CACHE_MS) return this.cache.checks;
        if (!this.pending) {
            this.pending = this.build_checks(now)
                .then(checks => {
                    this.cache = { at: now, checks };
                    return checks;
                })
                .finally(() => (this.pending = null));
        }
        return await this.pending;
    }

    private async build_checks(now: number): Promise<Check[]> {
        const postgres_ms = await this.round_trip(() => this.data_source.query('SELECT 1'));
        const mongo_ms = await this.round_trip(() => this.status_manager.ping_mongo());
        let heartbeat: number | null = null;
        try {
            heartbeat = await this.status_manager.heartbeat_at();
        } catch {
            // Mongo down: the database check says so; the processor's state is unknown as down
        }
        const e2e = await this.admin_service.e2e();
        return [
            database_check(postgres_ms, mongo_ms),
            processor_check(heartbeat, now),
            e2e_check(e2e, now)
        ];
    }

    private async round_trip(fn: () => Promise<unknown>): Promise<number | null> {
        const start = Date.now();
        let timer: NodeJS.Timeout | undefined;
        try {
            await Promise.race([
                fn(),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('timed out')), ROUND_TRIP_TIMEOUT_MS);
                })
            ]);
            return Date.now() - start;
        } catch (ex) {
            logger.warn(`Status: database round trip failed: ${ex && ex.message}`);
            return null;
        } finally {
            clearTimeout(timer);
        }
    }
}
