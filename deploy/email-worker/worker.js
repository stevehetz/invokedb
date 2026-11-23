// Cloudflare Email Worker for mail sent to @invokedb.com (see README.md beside this file).
//
// Mail to one of TELEGRAM_ONLY_RECIPIENTS (e.g. uptime@) is never forwarded: if it comes from an
// alert service (ALERT_SENDER_DOMAINS) it's posted to Telegram as a short notice (sender,
// recipient, subject), and otherwise it's dropped, so spam to that address goes nowhere.
//
// Every other message is forwarded to FORWARD_TO (if set). A Telegram notice is also posted when
// it comes from an alert service or is addressed to one of NOTIFY_RECIPIENTS. Everything else
// only goes to FORWARD_TO, so spam sent to a public address doesn't end up in Telegram.
//
// Settings (Worker → Settings → Variables and Secrets):
//   TELEGRAM_BOT_TOKEN    secret, the contact-form bot's token (deploy/prod.env)
//   TELEGRAM_CHAT_ID      the same chat as the contact form (deploy/prod.env)
//   FORWARD_TO            optional, a verified Email Routing destination address
//   ALERT_SENDER_DOMAINS  comma-separated, e.g. "uptimerobot.com,healthchecks.io"
//   NOTIFY_RECIPIENTS     optional, comma-separated local parts that also get a notice
//   TELEGRAM_ONLY_RECIPIENTS  comma-separated local parts, e.g. "uptime"
//
// No npm packages, so it can be pasted into the dashboard editor as is.

const list = value =>
    (value || '')
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);

// "Uptime Robot <alert@uptimerobot.com>" → "alert@uptimerobot.com"
const address_of = value => {
    const match = /<([^>]+)>/.exec(value || '');
    return (match ? match[1] : value || '').trim().toLowerCase();
};

const domain_of = address => address.split('@').pop();

const domain_matches = (domain, domains) =>
    domains.some(d => domain === d || domain.endsWith('.' + d));

async function send_telegram(env, text) {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    // Plain text (no parse_mode), so a subject line can't inject formatting.
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: text.slice(0, 4000) })
    });
    if (!res.ok) {
        throw new Error(`Telegram responded ${res.status}: ${await res.text()}`);
    }
}

export default {
    async email(message, env) {
        const subject = message.headers.get('subject') || '(no subject)';
        const header_from = address_of(message.headers.get('from'));
        const envelope_from = (message.from || '').toLowerCase();
        const to = (message.to || '').toLowerCase();

        // The From header is what the alert service puts its name on; the envelope sender is
        // often a bounce address at its mail provider, so accept either.
        const alert_domains = list(env.ALERT_SENDER_DOMAINS);
        const from_alert_service =
            domain_matches(domain_of(header_from), alert_domains) ||
            domain_matches(domain_of(envelope_from), alert_domains);
        const local_part = to.split('@')[0];
        const telegram_only = list(env.TELEGRAM_ONLY_RECIPIENTS).includes(local_part);
        const to_notify_address = list(env.NOTIFY_RECIPIENTS).includes(local_part);

        const forward = Boolean(env.FORWARD_TO) && !telegram_only;
        const notify = telegram_only ? from_alert_service : from_alert_service || to_notify_address;

        const jobs = [];
        if (forward) {
            jobs.push(message.forward(env.FORWARD_TO));
        }
        if (notify) {
            const text = `📧 ${subject}\nFrom: ${header_from || envelope_from}\nTo: ${to}`;
            jobs.push(send_telegram(env, text));
        }

        // One failing (e.g. Telegram down) shouldn't stop the other; log failures so they show
        // in the Worker's logs.
        const results = await Promise.allSettled(jobs);
        for (const r of results) {
            if (r.status === 'rejected') console.error(String(r.reason));
        }
        console.log(
            `to=${to} from=${header_from || envelope_from} alert=${from_alert_service} ` +
                `telegram_only=${telegram_only} notified=${notify} forwarded=${forward}`
        );
    }
};
