// The emails at 80% and 100% of the monthly `/api/v1` quota (#274, docs/PRICING.md 3.4)

export type QuotaLevel = 80 | 100;
export const QUOTA_LEVELS: QuotaLevel[] = [80, 100];

/** The call count at which a level is reached: 80% is the first call at or past 80% of the cap. */
export function quota_threshold(cap: number, level: QuotaLevel) {
    return Math.ceil((cap * level) / 100);
}

/**
 * The level to email about after a call took the month's count to `count`: the highest level
 * reached that hasn't been sent (`sent`, from the month's document), or null. A call that
 * reaches 100% before the 80% email went out sends only the 100% one. No cap (internal
 * accounts): never.
 */
export function quota_level_to_send(count: number, cap: number, sent: unknown): QuotaLevel | null {
    if (!Number.isFinite(cap) || cap <= 0) return null;
    const done = Array.isArray(sent) ? sent : [];
    const reached = QUOTA_LEVELS.filter(l => count >= quota_threshold(cap, l));
    if (reached.length === 0) return null;
    const highest = reached[reached.length - 1];
    return done.includes(highest) ? null : highest;
}

/** The levels a claim of `level` marks as sent: it and every lower one. */
export function quota_levels_up_to(level: QuotaLevel): QuotaLevel[] {
    return QUOTA_LEVELS.filter(l => l <= level);
}
