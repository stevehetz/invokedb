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

    /**
     * One call whose answer is JSON in `schema` (structured outputs), for generated rows and
     * table designs (#148). Returns the parsed answer, plus the reply's usage and model for
     * costing it; throws an AiModelError when the model declines or its answer is cut off (the
     * usage is on the error, since the call is paid for either way).
     */
    async json(request: {
        system: string;
        prompt: string;
        schema: Record<string, unknown>;
        max_tokens: number;
    }): Promise<{ data: unknown; usage: Anthropic.Usage; model: string }> {
        const { reply, model } = await this.create_message({
            max_tokens: request.max_tokens,
            system: request.system,
            messages: [{ role: 'user', content: request.prompt }],
            output_config: {
                effort: 'low',
                format: { type: 'json_schema', schema: request.schema }
            }
        });
        const usage = reply.usage;
        if (reply.stop_reason === 'refusal') {
            throw new AiModelError('The AI declined this request', usage, model);
        }
        const text = (reply.content || [])
            .map(block => (block.type === 'text' ? block.text : ''))
            .join('');
        try {
            return { data: JSON.parse(text), usage, model };
        } catch (ex) {
            // Usually a cut-off answer (stop_reason max_tokens)
            throw new AiModelError(
                `The AI's answer wasn't complete (${reply.stop_reason})`,
                usage,
                model
            );
        }
    }
}

/** A model answer that can't be used. The call still cost `usage` on `model`. */
export class AiModelError extends Error {
    constructor(
        message: string,
        readonly usage?: Anthropic.Usage,
        readonly model?: string
    ) {
        super(message);
    }
}
