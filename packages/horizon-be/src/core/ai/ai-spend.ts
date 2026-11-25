import { Injectable } from '@nestjs/common';
import { AiClient } from './ai-client';
import { AiUsageManager } from './ai-usage.manager';
import { call_cost_micros, crossed_alerts } from './ai-plan';
import { send_telegram, telegram_configured } from '../telegram/telegram';
import logger from '@app/logger';

// What the AI features spend (docs/PRICING.md 3.5), shared by "ask your data" (#149) and
// generated rows and tables (#148): whether the server's monthly budget is spent, and charging
// a model call to the account and the server, with Telegram alerts at 50%, 80% and 100%.
@Injectable()
export class AiSpend {
    constructor(
        private ai_client: AiClient,
        private ai_usage: AiUsageManager
    ) {}

    /** The server has spent its monthly AI budget: AI is paused for everyone. */
    async paused(month: string) {
        return (await this.ai_usage.server_cost(month)) >= this.ai_client.budget_micros();
    }

    /**
     * Charges what calls used (their `usage`, summed) to the account's month and the server's.
     * Returns the cost in micro-dollars.
     */
    async charge(
        account_id: number,
        month: string,
        calls: { model: string; usage: any }[]
    ): Promise<number> {
        let input_tokens = 0;
        let output_tokens = 0;
        let cost = 0;
        calls.forEach(c => {
            if (!c || !c.usage) return;
            input_tokens += c.usage.input_tokens || 0;
            output_tokens += c.usage.output_tokens || 0;
            cost += call_cost_micros(c.model, c.usage);
        });
        if (!input_tokens && !output_tokens && !cost) return 0;
        await this.ai_usage.add_usage(account_id, month, input_tokens, output_tokens, cost);
        await this.add_server_cost(month, cost);
        return cost;
    }

    private async add_server_cost(month: string, cost_micros: number) {
        if (!(cost_micros > 0)) return;
        const budget = this.ai_client.budget_micros();
        const { before, after } = await this.ai_usage.add_server_cost(month, cost_micros);
        for (const level of crossed_alerts(before, after, budget)) {
            const text =
                `InvokeDB: AI spending for ${month} reached ${Math.round(level * 100)}% of the ` +
                `$${(budget / 1e6).toFixed(2)} budget ($${(after / 1e6).toFixed(2)} so far).` +
                (level >= 1 ? ' AI features are paused until the 1st (UTC).' : '');
            logger.warn(text);
            if (!telegram_configured()) continue;
            try {
                await send_telegram(text);
            } catch (ex) {
                logger.error(`ai budget alert: Telegram failed: ${ex && ex.message}`);
            }
        }
    }
}
