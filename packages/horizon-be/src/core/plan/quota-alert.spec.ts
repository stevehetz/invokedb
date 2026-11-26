import { quota_level_to_send, quota_levels_up_to, quota_threshold } from './quota-alert';

describe('quota emails', () => {
    it('reaches 80% at the first call at or past 80% of the cap', () => {
        expect(quota_threshold(10_000, 80)).toBe(8_000);
        expect(quota_threshold(7, 80)).toBe(6);
        expect(quota_threshold(10_000, 100)).toBe(10_000);
    });

    it('names the highest level reached and not sent', () => {
        expect(quota_level_to_send(7_999, 10_000, undefined)).toBeNull();
        expect(quota_level_to_send(8_000, 10_000, undefined)).toBe(80);
        expect(quota_level_to_send(9_999, 10_000, [80])).toBeNull();
        expect(quota_level_to_send(10_000, 10_000, [80])).toBe(100);
        expect(quota_level_to_send(10_000, 10_000, undefined)).toBe(100);
        expect(quota_level_to_send(10_000, 10_000, [80, 100])).toBeNull();
    });

    it('never for no cap', () => {
        expect(quota_level_to_send(1e9, Infinity, undefined)).toBeNull();
        expect(quota_level_to_send(5, 0, undefined)).toBeNull();
    });

    it('marks the lower levels with a higher one', () => {
        expect(quota_levels_up_to(80)).toEqual([80]);
        expect(quota_levels_up_to(100)).toEqual([80, 100]);
    });
});
