# Workstream

_Last updated 2026-11-23_

The task in progress, as a full ordered checklist. **Agents keep this file current**: tick a
step off as soon as it's done, add any step that turns up, and keep the "Now" marker on the
next one. When the user asks "what's next", give them **only the "Now" step** (one step, with
the exact clicks or command), never the whole list. `docs/HANDOFF.md` has the background and
history; this file has only the steps.

Who: **You** = the user; **Claude** = a coding agent (it says when it needs your OK).

## Support email and alert routing

Goal (decided 2026-11-22): nothing goes to the personal Gmail. Mail to `@invokedb.com` goes to
the support Gmail `invokedbsupport@gmail.com`, the contact form emails `support@invokedb.com`,
and UptimeRobot alerts go to `uptime@invokedb.com`, then Telegram only. Details: HANDOFF step 5,
"Still to do", item 4.

- [x] 1. You: create `invokedbsupport@gmail.com` (2026-11-23).
- [x] 2. You: in Cloudflare Email Routing, verify it as a destination, set the Worker's
      `FORWARD_TO` to it, remove the personal address (2026-11-23).
- [x] 3. Claude: Worker gets `TELEGRAM_ONLY_RECIPIENTS` (`uptime@` → Telegram only, spam
      dropped); contact form emails `SUPPORT_EMAIL` with Telegram as the fallback. On branch
      `support-email-routing`, uncommitted (2026-11-23).
- [x] 4. Claude (in Chrome): Worker `invokedb-email` updated to `deploy/email-worker/worker.js`
      and deployed; `TELEGRAM_ONLY_RECIPIENTS` = `uptime` added, `NOTIFY_RECIPIENTS` deleted
      (2026-11-23).
- [x] 5. You: test it (passed 2026-11-23). From an outside mailbox, send to `support@invokedb.com` (should reach
      the support Gmail, no Telegram message) and to `uptime@invokedb.com` (should arrive
      nowhere).
- [x] 6. UptimeRobot → support Gmail directly, no Telegram (decided 2026-11-23: the
      free plan only emails the account's login address, so `uptime@` → Telegram-only would
      also swallow its login and reset mail, and the user doesn't want double notices). Done:
      Claude changed the account's primary email to `invokedbsupport@gmail.com` (you
      confirmed it), sent a test notification from the `api.invokedb.com` monitor, and deleted
      the duplicate `invokedb.com` monitor (two monitors left). The test DOWN/UP alerts reached the support Gmail.
- [ ] 7. **Now.** Claude committed the branch `support-email-routing` (2026-11-23). You: review
      it and merge it to `main`.
- [ ] 8. Claude, with your OK: `npm run secrets:pull` (the repo's `deploy/prod.env` is stale),
      add `SUPPORT_EMAIL=support@invokedb.com`, `npm run secrets:push`.
- [ ] 9. Claude, when you say so: `deploy/deploy.sh up` from `main`. This also ships the
      login/reset fix that's waiting.
- [ ] 10. You: send a message through the contact form on `https://invokedb.com`; it should
      reach the support Gmail, and Reply should go to the address you entered.
- [ ] 11. You: in Mailgun, `mail.invokedb.com` → SMTP Credentials → create a login (Claude adds
      it to the secrets).
- [ ] 12. You: in the support Gmail, Settings → Accounts → "Send mail as"
      `support@invokedb.com` through `smtp.mailgun.org`, port 587, with that login. The
      confirmation code arrives in the same Gmail.
- [ ] 13. Claude: mark item 4 done in HANDOFF (UptimeRobot row: support Gmail, not Telegram;
      `uptime@` / `TELEGRAM_ONLY_RECIPIENTS` is unused but still set on the Worker), drop the "Telegram for the contact form"
      wording, and start the next workstream below.

## Up next

1. A person checks signup, table creation, CSV upload and API calls in production.
2. 5b: Google and GitHub sign-in (HANDOFF, Next steps).
