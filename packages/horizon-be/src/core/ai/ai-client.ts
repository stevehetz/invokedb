import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import env from '@app/env';
import { DEFAULT_AI_MODEL, server_budget_micros } from './ai-plan';

// The one place the backend talks to the Anthropic API (#149). AI features are off (hidden in
// the app, 503 from their routes) unless the server has both ANTHROPIC_API_KEY and a monthly
// budget (HORIZON_AI_MONTHLY_BUDGET_USD, docs/PRICING.md 3.5). The key never leaves the
// backend. The unit tests replace this class; the API smoke test points ANTHROPIC_BASE_URL at a
// stub (scripts/smoke-env.sh).
@Injectable()
export class AiClient {
    private client: Anthropic | null = null;

    available() {
        return !!env.ANTHROPIC_API_KEY && this.budget_micros() > 0;
    }

    /** The server-wide monthly AI budget, in micro-dollars. */
    budget_micros() {
        return server_budget_micros(env.HORIZON_AI_MONTHLY_BUDGET_USD);
    }

    model() {
        return env.HORIZON_AI_MODEL || DEFAULT_AI_MODEL;
    }

    private get_client() {
        if (!this.client) {
            this.client = new Anthropic({
                apiKey: env.ANTHROPIC_API_KEY,
                baseURL: env.ANTHROPIC_BASE_URL || undefined,
                maxRetries: 2,
                timeout: 60 * 1000
            });
        }
        return this.client;
    }

    /**
     * One model call at low effort, with the stable start of the request (tools, system
     * prompt) cached so a question's later turns cost less. Returns the reply and the model
     * that answered, for costing it.
     */
    async create_message(
        params: Omit<Anthropic.MessageCreateParamsNonStreaming, 'model'>
    ): Promise<{ reply: Anthropic.Message; model: string }> {
        const model = this.model();
        const reply = await this.get_client().messages.create({
            output_config: { effort: 'low' },
            cache_control: { type: 'ephemeral' },
            ...params,
            model
        });
        return { reply, model };
    }
}
