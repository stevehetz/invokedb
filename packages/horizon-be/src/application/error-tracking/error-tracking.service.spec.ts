import { BadRequestException } from '@nestjs/common';
import { ALERTS_PER_HOUR } from '@app/core/error-tracking/error-tracking';
import { report_error } from '@app/core/error-tracking/report';
import { ErrorTrackingService } from './error-tracking.service';

jest.mock('@app/logger', () => ({
    __esModule: true,
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

function setup() {
    const seen = new Set<string>();
    const alerted = new Set<string>();
    const manager: any = {
        record: jest.fn(async (event: any) => {
            const id = `fp-${event.message}`.padEnd(24, '0').slice(0, 24);
            const is_new = !seen.has(id);
            seen.add(id);
            return { id, is_new, stored: true };
        }),
        claim_alert: jest.fn(async (id: string) => {
            if (alerted.has(id)) return false;
            alerted.add(id);
            return true;
        }),
        list: jest.fn(async q => ({ errors: [], total: 0, ...q })),
        get: jest.fn(async () => null)
    };
    const service = new ErrorTrackingService(manager);
    const sent: string[] = [];
    service.notify = jest.fn(async text => {
        sent.push(text);
    });
    return { service, manager, sent };
}

describe('ErrorTrackingService', () => {
    it('alerts once for a new error, not for the next occurrences', async () => {
        const { service, sent } = setup();
        await service.record_client({ message: 'boom' }, null, null);
        await service.record_client({ message: 'boom' }, null, null);
        expect(sent).toHaveLength(1);
        expect(sent[0]).toContain('new frontend error');
    });

    it('sends at most ALERTS_PER_HOUR frontend alerts an hour', async () => {
        const { service, sent } = setup();
        let now = 1_000_000;
        service.now = () => now;
        for (let i = 0; i < ALERTS_PER_HOUR.frontend + 5; i++) {
            await service.record_client({ message: `boom ${'x'.repeat(i)}` }, null, null);
        }
        expect(sent).toHaveLength(ALERTS_PER_HOUR.frontend);
        now += 60 * 60 * 1000;
        await service.record_client({ message: 'later' }, null, null);
        expect(sent).toHaveLength(ALERTS_PER_HOUR.frontend + 1);
    });

    it("keeps the backend's alert budget when frontend reports use up theirs", async () => {
        const { service, sent } = setup();
        service.now = () => 1_000_000;
        for (let i = 0; i < ALERTS_PER_HOUR.frontend + 5; i++) {
            await service.record_client({ message: `spam ${'x'.repeat(i)}` }, null, null);
        }
        expect(sent).toHaveLength(ALERTS_PER_HOUR.frontend);
        await report_error('api', new Error('real 5xx'), { route: 'GET /web-file/:id' });
        expect(sent).toHaveLength(ALERTS_PER_HOUR.frontend + 1);
        for (let i = 0; i < ALERTS_PER_HOUR.backend + 5; i++) {
            await report_error('processor', new Error(`job ${'y'.repeat(i)}`), {});
        }
        expect(sent).toHaveLength(ALERTS_PER_HOUR.frontend + ALERTS_PER_HOUR.backend);
        service.onModuleDestroy();
    });

    it('backs report_error, and never throws when storing fails', async () => {
        const { service, manager } = setup();
        await report_error('processor', new Error('job broke'), { route: 'job FILE_UPLOAD' });
        expect(manager.record).toHaveBeenCalledWith(
            expect.objectContaining({ source: 'processor', route: 'job FILE_UPLOAD' }),
            expect.any(Number)
        );
        manager.record.mockRejectedValueOnce(new Error('mongo down'));
        await expect(service.record_client({ message: 'x' }, null, null)).resolves.toEqual({
            recorded: true
        });
        service.onModuleDestroy();
    });

    it('answers 400 for a bad report or query, 404 for an unknown error', async () => {
        const { service } = setup();
        await expect(service.record_client({}, null, null)).rejects.toBeInstanceOf(
            BadRequestException
        );
        await expect(service.list({ source: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
        await expect(service.get('0'.repeat(24))).rejects.toThrow('Error not found');
        service.onModuleDestroy();
    });
});
