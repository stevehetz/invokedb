import env from '@app/env';

// Messages to the owner's Telegram chat (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID; optional).
// Used by the contact form's fallback and the AI budget alerts.

export function telegram_configured() {
    return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

// Telegram Bot API: https://core.telegram.org/bots/api#sendmessage
// Sent as plain text (no parse_mode), so user input can't inject formatting.
export async function send_telegram(text: string) {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
        signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) {
        throw new Error(`Telegram responded ${res.status}: ${await res.text()}`);
    }
}
