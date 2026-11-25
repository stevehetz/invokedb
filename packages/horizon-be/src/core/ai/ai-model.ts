import Anthropic from '@anthropic-ai/sdk';
import env from '@app/env';

// The model behind the AI features (#148). The backend calls it; the key never reaches the
// browser. Without ANTHROPIC_API_KEY there is no model, the AI routes answer 503 and the app
// hides its AI buttons. HORIZON_AI_STUB (set only by scripts/smoke-env.sh) swaps in a stand-in
// that makes up rows from the schema, so the smoke tests never call the real model.

export const DEFAULT_AI_MODEL = 'claude-opus-5-5';

export interface AiModelRequest {
    system: string;
    prompt: string;
    /** JSON schema of the answer */
    schema: Record<string, unknown>;
    max_tokens: number;
    /** Rows asked for, when the answer is `{ rows: [...] }` (the stub uses it) */
    rows?: number;
}

export interface AiModel {
    readonly name: string;
    /** The model's answer, parsed from JSON in the requested schema. */
    json(request: AiModelRequest): Promise<unknown>;
}

export class AiModelError extends Error {}

export class AnthropicModel implements AiModel {
    private client: Anthropic;

    constructor(
        api_key: string,
        readonly name: string = DEFAULT_AI_MODEL
    ) {
        this.client = new Anthropic({ apiKey: api_key, maxRetries: 2, timeout: 5 * 60 * 1000 });
    }

    async json(request: AiModelRequest): Promise<unknown> {
        const message = await this.client.messages.create({
            model: this.name,
            max_tokens: request.max_tokens,
            system: request.system,
            messages: [{ role: 'user', content: request.prompt }],
            output_config: { format: { type: 'json_schema', schema: request.schema } }
        });
        if (message.stop_reason === 'refusal') {
            throw new AiModelError('The AI declined this request');
        }
        const text = message.content
            .map(block => (block.type === 'text' ? block.text : ''))
            .join('');
        try {
            return JSON.parse(text);
        } catch (ex) {
            // Usually a cut-off answer (stop_reason max_tokens)
            throw new AiModelError(`The AI's answer wasn't complete (${message.stop_reason})`);
        }
    }
}

const STUB_COLUMNS = [
    { name: 'Name', type: 'string' },
    { name: 'Amount', type: 'number' },
    { name: 'Date', type: 'date' }
];

/** Made-up answers that fit the schema, for tests: no network, always the same. */
export class StubModel implements AiModel {
    readonly name = 'stub';

    async json(request: AiModelRequest): Promise<unknown> {
        const props: any = (request.schema as any).properties || {};
        if (props.columns) {
            return { table_name: 'stub_table', columns: STUB_COLUMNS };
        }
        const item = props.rows && props.rows.items ? props.rows.items.properties || {} : {};
        const rows = [];
        for (let i = 0; i < (request.rows || 0); i++) {
            const row = {};
            Object.keys(item).forEach(field => {
                const typed = (item[field].anyOf || [])[0] || {};
                const label = String(item[field].description || field).split(' (')[0];
                if (typed.type === 'number') row[field] = i + 1;
                else if (typed.format === 'date') {
                    row[field] = `2026-01-${String((i % 28) + 1).padStart(2, '0')}`;
                } else row[field] = `${label} ${i + 1}`;
            });
            rows.push(row);
        }
        return { rows };
    }
}

/** The configured model, or null when the AI features are off. */
export function ai_model_from_env(): AiModel | null {
    if (env.HORIZON_AI_STUB) return new StubModel();
    if (!env.ANTHROPIC_API_KEY) return null;
    return new AnthropicModel(env.ANTHROPIC_API_KEY, env.HORIZON_AI_MODEL || DEFAULT_AI_MODEL);
}
