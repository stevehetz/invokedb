// What the AI features may cost (docs/PRICING.md 3.5, decided 2026-11-25). Pure functions,
// unit-tested in ai-plan.spec.ts. Every tier uses the cheap model; an account's monthly use is
// capped twice, by a count (what the app shows) and by a dollar budget worked out from the
// tokens each call used, and the whole server has a monthly budget on top
// (HORIZON_AI_MONTHLY_BUDGET_USD). Money is kept in micro-dollars (integers) so sums don't drift.

// The model every tier uses. HORIZON_AI_MODEL overrides it.
export const DEFAULT_AI_MODEL = 'claude-haiku-5-5';

export interface ModelPrice {
    // US dollars per million tokens
    input: number;
    output: number;
    cache_read: number;
    cache_write: number;
}

// Anthropic's list prices (2026-11). A model that isn't listed is costed at UNKNOWN_MODEL_PRICE,
// above any of these, so a model change can only make the caps stricter until it's added here.
export const AI_PRICES: Record<string, ModelPrice> = {
    'claude-haiku-5-5': { input: 0.1, output: 0.5, cache_read: 0.01, cache_write: 0.125 },
    'claude-sonnet-5-5': { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5 },
    'claude-opus-5-5': { input: 4, output: 20, cache_read: 0.2, cache_write: 5 }
};
export const UNKNOWN_MODEL_PRICE: ModelPrice = {
    input: 10,
    output: 50,
    cache_read: 1,
    cache_write: 12.5
};

export type AiTier = 'FREE' | 'STARTER' | 'PRO';

export interface AiAllowance {
    tier: AiTier;
    // Questions per month (#149)
    questions: number;
    // Generated rows per month (#148)
    rows: number;
    // What the account's AI use may cost per month, in micro-dollars
    budget_micros: number;
    // False when the account's email isn't verified: no AI at all
    verified: boolean;
}

// Per account and UTC month (docs/PRICING.md 3.5)
export const AI_ALLOWANCES: Record<
    AiTier,
    { questions: number; rows: number; budget_usd: number }
> = {
    FREE: { questions: 10, rows: 50, budget_usd: 0.05 },
    STARTER: { questions: 300, rows: 1000, budget_usd: 1 },
    PRO: { questions: 2000, rows: 10000, budget_usd: 5 }
};

// Today's plans until #183 brings the new plan constant
const PLAN_TIERS: Record<string, AiTier> = {
    FREE: 'FREE',
    BASIC: 'STARTER',
    PLUS: 'PRO',
    PREMIUM: 'PRO'
};

// Share of the server-wide budget at which the owner is told (Telegram)
export const BUDGET_ALERTS = [0.5, 0.8, 1];

export const usd_to_micros = (usd: number) => Math.round(usd * 1_000_000);

/** The AI tier of a subscription id: SUB_FREE, SUB_TEST_PLUS, SUB_LIVE_BASIC... */
export function ai_tier(subscription_id: string | null | undefined): AiTier {
    if (!subscription_id) return 'FREE';
    const plan = String(subscription_id)
        .replace(/^SUB_(TEST_|LIVE_)?/, '')
        .toUpperCase();
    return PLAN_TIERS[plan] || 'FREE';
}

/** What an account may use this month. An unverified account gets nothing. */
export function ai_allowance(account: {
    subscription_id?: string | null;
    email_verified?: boolean;
}): AiAllowance {
    const tier = ai_tier(account.subscription_id);
    const a = AI_ALLOWANCES[tier];
    const verified = account.email_verified !== false;
    return {
        tier,
        questions: verified ? a.questions : 0,
        rows: verified ? a.rows : 0,
        budget_micros: verified ? usd_to_micros(a.budget_usd) : 0,
        verified
    };
}

export function model_price(model: string): ModelPrice {
    return AI_PRICES[model] || UNKNOWN_MODEL_PRICE;
}

/** What one model call cost, in micro-dollars (rounded up), from the reply's `usage`. */
export function call_cost_micros(model: string, usage: any): number {
    if (!usage) return 0;
    const p = model_price(model);
    const n = (v: unknown) => (typeof v === 'number' && v > 0 ? v : 0);
    // $ per million tokens = micro-dollars per token
    const micros =
        n(usage.input_tokens) * p.input +
        n(usage.output_tokens) * p.output +
        n(usage.cache_read_input_tokens) * p.cache_read +
        n(usage.cache_creation_input_tokens) * p.cache_write;
    return Math.ceil(micros);
}

/** The server-wide monthly budget in micro-dollars; 0 (AI off) when unset or not a number. */
export function server_budget_micros(value: string | undefined): number {
    const usd = Number(value);
    return Number.isFinite(usd) && usd > 0 ? usd_to_micros(usd) : 0;
}

/** The alert levels (BUDGET_ALERTS) that spending went past, from `before` to `after`. */
export function crossed_alerts(before: number, after: number, budget: number): number[] {
    if (!(budget > 0)) return [];
    return BUDGET_ALERTS.filter(level => before < level * budget && after >= level * budget);
}

/** The usage period of a moment: its UTC month, "2026-11". */
export function usage_month(now: number) {
    return new Date(now).toISOString().slice(0, 7);
}
