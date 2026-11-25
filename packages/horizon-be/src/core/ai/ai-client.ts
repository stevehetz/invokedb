import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import env from '@app/env';

// The Claude model the AI features use. HORIZON_AI_MODEL overrides it.
export const DEFAULT_AI_MODEL = 'claude-opus-5-5';

// The one place the backend talks to the Anthropic API (#149). AI features are off (hidden in
// the app, 503 from their routes) unless ANTHROPIC_API_KEY is set. The key never leaves the
// backend. The unit tests replace this class; the API smoke test points ANTHROPIC_BASE_URL at a
// stub (scripts/smoke-env.sh).
@Injectable()
export class AiClient {
    private client: Anthropic | null = null;

    available() {
        return !!env.ANTHROPIC_API_KEY;
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

    async create_message(
        params: Omit<Anthropic.MessageCreateParamsNonStreaming, 'model'>
    ): Promise<Anthropic.Message> {
        return await this.get_client().messages.create({ ...params, model: this.model() });
    }
}
