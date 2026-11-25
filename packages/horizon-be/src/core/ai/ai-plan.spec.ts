import {
    AI_ALLOWANCES,
    AI_PRICES,
    UNKNOWN_MODEL_PRICE,
    ai_allowance,
    ai_tier,
    call_cost_micros,
    crossed_alerts,
    server_budget_micros,
    usage_month
} from './ai-plan';

describe('ai-plan', () => {
    it('maps the plans to AI tiers', () => {
        expect(ai_tier(null)).toBe('FREE');
        expect(ai_tier('SUB_FREE')).toBe('FREE');
        expect(ai_tier('SUB_TEST_BASIC')).toBe('STARTER');
        expect(ai_tier('SUB_LIVE_PLUS')).toBe('PRO');
        expect(ai_tier('SUB_LIVE_PREMIUM')).toBe('PRO');
        expect(ai_tier('SUB_SOMETHING_ELSE')).toBe('FREE');
    });

    it('has the allowances of docs/PRICING.md 3.5', () => {
        expect(AI_ALLOWANCES.FREE).toEqual({ questions: 10, rows: 50, budget_usd: 0.05 });
        expect(AI_ALLOWANCES.STARTER).toEqual({ questions: 300, rows: 1000, budget_usd: 1 });
        expect(AI_ALLOWANCES.PRO).toEqual({ questions: 2000, rows: 10000, budget_usd: 5 });
    });

    it('gives an unverified account nothing', () => {
        expect(ai_allowance({ subscription_id: 'SUB_LIVE_PLUS', email_verified: true })).toEqual({
            tier: 'PRO',
            questions: 2000,
            rows: 10000,
            budget_micros: 5_000_000,
            verified: true
        });
        expect(ai_allowance({ subscription_id: 'SUB_LIVE_PLUS', email_verified: false })).toEqual({
            tier: 'PRO',
            questions: 0,
            rows: 0,
            budget_micros: 0,
            verified: false
        });
    });

    it('keeps every tier at its caps within its budget on the default model', () => {
        // ~8k input and ~1k output tokens per question (docs/PRICING.md 3.5)
        const question = call_cost_micros('claude-haiku-5-5', {
            input_tokens: 8000,
            output_tokens: 1000
        });
        Object.values(AI_ALLOWANCES).forEach(a => {
            expect(a.questions * question).toBeLessThanOrEqual(a.budget_usd * 1_000_000);
        });
    });

    it('works out what a call cost, rounded up', () => {
        expect(
            call_cost_micros('claude-haiku-5-5', { input_tokens: 8000, output_tokens: 1000 })
        ).toBe(1300);
        expect(
            call_cost_micros('claude-sonnet-5-5', {
                input_tokens: 1000,
                output_tokens: 100,
                cache_read_input_tokens: 2000,
                cache_creation_input_tokens: 400
            })
        ).toBe(2000 + 1000 + 200 + 1000);
        expect(call_cost_micros('claude-haiku-5-5', { input_tokens: 3, output_tokens: 0 })).toBe(1);
        expect(call_cost_micros('claude-haiku-5-5', null)).toBe(0);
        expect(call_cost_micros('claude-haiku-5-5', { input_tokens: -5, output_tokens: 'x' })).toBe(
            0
        );
    });

    it('costs an unknown model above every listed one', () => {
        Object.values(AI_PRICES).forEach(p => {
            expect(UNKNOWN_MODEL_PRICE.input).toBeGreaterThan(p.input);
            expect(UNKNOWN_MODEL_PRICE.output).toBeGreaterThan(p.output);
        });
        expect(call_cost_micros('claude-new-9', { input_tokens: 1000 })).toBe(10_000);
    });

    it('reads the server budget', () => {
        expect(server_budget_micros('20')).toBe(20_000_000);
        expect(server_budget_micros('0.5')).toBe(500_000);
        expect(server_budget_micros(undefined)).toBe(0);
        expect(server_budget_micros('')).toBe(0);
        expect(server_budget_micros('lots')).toBe(0);
        expect(server_budget_micros('-3')).toBe(0);
    });

    it('says which alert levels were passed', () => {
        expect(crossed_alerts(0, 400, 1000)).toEqual([]);
        expect(crossed_alerts(400, 500, 1000)).toEqual([0.5]);
        expect(crossed_alerts(499, 1200, 1000)).toEqual([0.5, 0.8, 1]);
        expect(crossed_alerts(800, 900, 1000)).toEqual([]);
        expect(crossed_alerts(0, 100, 0)).toEqual([]);
    });

    it('works in UTC months', () => {
        expect(usage_month(Date.UTC(2026, 10, 30, 23, 59))).toBe('2026-11');
        expect(usage_month(Date.UTC(2026, 11, 1, 0, 0))).toBe('2026-12');
    });
});
