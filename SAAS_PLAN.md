# SaaS Plan

What it takes to turn InvokeDB into a real paid product. Deployment and SSO already have
plans in `HANDOFF.md` (steps 3–5b). This covers the rest. AI features are in `AI_IDEAS.md`.

## 1. Run it reliably

- Production hosting (start with HANDOFF step 5: one VM + docker compose, move to managed
  Postgres/Mongo once there are paying users).
- Nightly backups with a tested restore, plus point-in-time recovery for Mongo.
- Error tracking (Sentry), uptime checks, structured logs, and a public status page.
- Staging environment and CI (build, lint, api-smoke) before every deploy.

## 2. Accounts and teams

- SSO (HANDOFF 5b), email verification, password reset, optional 2FA.
- **Workspaces:** invite teammates, with roles (owner, editor, viewer) per workspace and per
  table.
- Account deletion and data export (GDPR).

## 3. Billing

- Bring Stripe back with new keys: Checkout + Customer Portal + webhooks as the source of
  truth for plan status.
- **Plans:** Free (a few tables, row cap, rate-limited API), Pro, Team (seats). AI credits per
  plan, with paid top-ups.
- Metering: rows stored, API calls/month, AI tokens. Show usage in the app and warn before
  limits.
- Trials, upgrade prompts when a limit is hit, dunning for failed payments.

## 4. Developer API (the core product)

- Today each account has one `api_key` (stored in plain text, full access, no rate limit).
  Replace it with multiple hashed keys per account, scoped read/write and per table, with
  rotation and revocation.
- Per-key rate limits (`@nestjs/throttler`) and usage logs.
- Versioned REST API (`/v1`), OpenAPI spec, auto-generated docs per table with copy-paste
  snippets.
- Webhooks on row changes; official JS/Python clients later.

## 5. Security and trust

- Tenant isolation checks on every query (one Mongo DB per account already helps).
- Audit log (who changed what), encryption at rest, secrets in a manager rather than files.
- Terms of service, privacy policy, DPA; SOC 2 later if selling to companies.

## 6. Growth

- Landing page with pricing, templates gallery ("CRM", "inventory", "waitlist"), docs site.
- Onboarding: sample table + "make your first API call" checklist.
- Product analytics (signups → first table → first API call → paid).
- Support: in-app contact, help docs, changelog.

## Suggested order

1. Deploy + backups + monitoring (HANDOFF 3–5)
2. SSO, email verification, password reset
3. API keys + rate limits + docs
4. Stripe plans + usage limits
5. Teams/roles, then AI features and forms/charts as Pro/Team selling points
