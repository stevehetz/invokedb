# Inbound email → Telegram

`invokedb.com` receives mail through **Cloudflare Email Routing**, which hands every message to
the Email Worker in `worker.js`:

- **`uptime@`** (`TELEGRAM_ONLY_RECIPIENTS`): never forwarded. Mail from an alert service
  (`ALERT_SENDER_DOMAINS`) posts a one-line Telegram notice (subject, sender, recipient) through
  the contact-form bot; anything else is dropped, so spam to it reaches neither Telegram nor an
  inbox. Nothing sends to `uptime@` today: UptimeRobot's free plan only emails the account's
  login address, which also gets its sign-in and reset mail, so its alerts go straight to the
  support Gmail instead. The setting is kept for a future alert-only address.
- **Everything else** (`support@`, contact-form emails, `demo*@` password resets, spam) is
  forwarded to the support Gmail (`FORWARD_TO`). Mail that comes from an alert service, or is
  addressed to one of `NOTIFY_RECIPIENTS` (empty: the inbox is enough), also posts a notice.

It runs on Cloudflare, not the droplet, so it keeps working if the server is down. Outbound mail
is unaffected: Mailgun sends from `mail.invokedb.com`, and Email Routing only adds records on
the root domain.

## Setup (Cloudflare dashboard, once)

1. **Email Routing:** `invokedb.com` → Email → Email Routing → enable. Let it add its MX and SPF
   (TXT) records on the root domain.
2. **Destination address:** Email Routing → Destination addresses → add the private inbox that
   should get the mail (the support Gmail, `invokedbsupport@gmail.com`), and click the link in
   the verification email.
3. **Worker:** Workers & Pages → Create → Worker ("Hello World"), name it `invokedb-email`,
   deploy, then Edit code, replace everything with `worker.js` and deploy again.
4. **Worker settings** (Settings → Variables and Secrets):

   | Name                       | Type   | Value                                              |
   | -------------------------- | ------ | -------------------------------------------------- |
   | `TELEGRAM_BOT_TOKEN`       | Secret | `TELEGRAM_BOT_TOKEN` from `deploy/prod.env`        |
   | `TELEGRAM_CHAT_ID`         | Text   | `TELEGRAM_CHAT_ID` from `deploy/prod.env`          |
   | `FORWARD_TO`               | Text   | the destination address from step 2                |
   | `ALERT_SENDER_DOMAINS`     | Text   | `uptimerobot.com,healthchecks.io,digitalocean.com` |
   | `NOTIFY_RECIPIENTS`        | Text   | empty (delete it, or leave the value blank)        |
   | `TELEGRAM_ONLY_RECIPIENTS` | Text   | `uptime`                                           |

5. **Route mail to it:** Email Routing → Routing rules → **Catch-all address** → action "Send to
   a Worker" → `invokedb-email` → enable.
6. **Test:** from any outside mailbox, send to `support@invokedb.com`: it's forwarded, no
   Telegram notice. Send to `uptime@invokedb.com`: nothing arrives anywhere (dropped, it isn't
   from an alert service; the Worker's log shows `telegram_only=true notified=false`).

## Notes

- Editing: change `worker.js` here, then paste it into the dashboard again (step 3). The
  settings stay. Logs: the Worker's Logs tab (turn on Workers Logs to keep them).
- The sender check reads the From header and the envelope sender. Anyone can fake a From
  address, so at worst a forged "alert" posts a notice to Telegram; nothing else trusts it.
- If alerts sent to a `TELEGRAM_ONLY_RECIPIENTS` address never show up in Telegram, check the
  Worker's log for the sender: its domain must be in `ALERT_SENDER_DOMAINS`, or the mail is
  dropped.
- Telegram fails → the forward still happens (and the other way round); failures are logged.
- Keep the bot token only in Cloudflare and `prod.env`. If it's revoked, update it here, in
  `prod.env` and in the Healthchecks webhook.
