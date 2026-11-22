# Inbound email → Telegram

`invokedb.com` receives mail through **Cloudflare Email Routing**, which hands every message to
the Email Worker in `worker.js`. The Worker forwards it to a private inbox and posts a one-line
Telegram notice (subject, sender, recipient) through the contact-form bot when the mail is from
an alert service (UptimeRobot etc.) or addressed to `alerts@` / `support@`. Other mail (spam,
password resets for the `demo*@` accounts) is only forwarded.

It runs on Cloudflare, not the droplet, so it keeps working if the server is down. Outbound mail
is unaffected: Mailgun sends from `mail.invokedb.com`, and Email Routing only adds records on
the root domain.

## Setup (Cloudflare dashboard, once)

1. **Email Routing:** `invokedb.com` → Email → Email Routing → enable. Let it add its MX and SPF
   (TXT) records on the root domain.
2. **Destination address:** Email Routing → Destination addresses → add the private inbox that
   should get copies, and click the link in the verification email.
3. **Worker:** Workers & Pages → Create → Worker ("Hello World"), name it `invokedb-email`,
   deploy, then Edit code, replace everything with `worker.js` and deploy again.
4. **Worker settings** (Settings → Variables and Secrets):

   | Name                   | Type   | Value                                              |
   | ---------------------- | ------ | -------------------------------------------------- |
   | `TELEGRAM_BOT_TOKEN`   | Secret | `TELEGRAM_BOT_TOKEN` from `deploy/prod.env`        |
   | `TELEGRAM_CHAT_ID`     | Text   | `TELEGRAM_CHAT_ID` from `deploy/prod.env`          |
   | `FORWARD_TO`           | Text   | the destination address from step 2                |
   | `ALERT_SENDER_DOMAINS` | Text   | `uptimerobot.com,healthchecks.io,digitalocean.com` |
   | `NOTIFY_RECIPIENTS`    | Text   | `alerts,support`                                   |

5. **Route mail to it:** Email Routing → Routing rules → **Catch-all address** → action "Send to
   a Worker" → `invokedb-email` → enable.
6. **Test:** from any outside mailbox, send to `support@invokedb.com`: a Telegram notice
   arrives and the mail is forwarded. Send to `hello@invokedb.com`: forwarded only.
7. **Use it:** add `alerts@invokedb.com` as an email alert contact in UptimeRobot (and anything
   else that can only alert by email).

## Notes

- Editing: change `worker.js` here, then paste it into the dashboard again (step 3). The
  settings stay. Logs: the Worker's Logs tab (turn on Workers Logs to keep them).
- The sender check reads the From header and the envelope sender. Anyone can fake a From
  address, so at worst a forged "alert" posts a notice to Telegram; nothing else trusts it.
- Telegram fails → the forward still happens (and the other way round); failures are logged.
- Keep the bot token only in Cloudflare and `prod.env`. If it's revoked, update it here, in
  `prod.env` and in the Healthchecks webhook.
