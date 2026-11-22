# Infrastructure plan

_Started 2026-11-17. Still a draft: the direction below is the current leaning, not a final
decision._

Where InvokeDB is heading and why. `HANDOFF.md` has the current state and the numbered steps.
`SAAS_PLAN.md` is the larger SaaS feature list, and this file narrows it.

## Goals

- **Learning, and something to show off.** It isn't a business yet.
- **No open free tier.** A free public service means abuse (spam signups, free storage, API
  hammering), holding strangers' data, and ops time for no return. The hosting bill is the
  small part.
- **A trial, then a paid plan through Stripe.** New accounts get a time-limited trial with hard
  caps on tables, rows and API calls. After it ends, the account turns read-only unless it
  upgrades. Stripe stays in the code for this.
- **Low, predictable cost:** about $5–15/month to start.

## Hosting: one always-on server

- **No scale-to-zero.** The websocket server and the processor's in-process jobs (`setTimeout`
  timeouts, the column type change) need a process that stays up, and a cold start would be
  the first impression. Free managed DB tiers also sleep or pause (Neon suspends after a few
  idle minutes, and Supabase pauses idle free projects), so they're out too.
- **One DigitalOcean droplet** (decided 2026-11-22): Basic 2 vCPU / 4 GB, about $29/month with
  backups, running `docker compose` with Caddy, the API, the processor, Postgres and Mongo
  (`deploy/`). Mongo's WiredTiger cache is capped (`MONGO_CACHE_GB`) so everything fits; resize
  to 8 GB ($48 + backups) if it's tight. Prices checked 2026-11-22: Hetzner's US servers roughly
  tripled in June 2026 (8 GB ~$74), and Azure's B2ms is ~$61 before disk and backups, so
  DigitalOcean is the cheapest of the three. It's above the $5–15 goal; that goal assumed the
  old Hetzner prices.

## Data: keep MongoDB (decided 2026-11-22)

**Decision:** keep Mongo for the grid data and Postgres for everything else, as today. The user
prefers this architecture: schemaless rows fit user-defined columns, and each account already
has its own Mongo database, which isolates tenants without an `account_id` filter on every
query. The cost is a second database to deploy, back up and restore.

The Postgres-only analysis below is kept for reference.

**How Mongo is used today:** all of it is in six files, mostly
`core/web-file/web-file.manager.ts`, plus `csv-processor.ts`, `web-file-prc.service.ts`,
`tracking.manager.ts`, `collections.ts` and `core.module.ts`. It does paged
find/sort/skip/limit with a count, a `$group` for distinct values, filters (`contains` and
`equals` as regexes, then `<`, `<=`, `>`, `>=`), a per-field index when a column is marked
"indexed", CSV bulk inserts, and rewriting every row on a column type change. It doesn't use
change streams, `$lookup`, sharding or text search.

**Shape:** a `grid_row` table (`account_id`, `file_id`, `row_index`, `data jsonb`). Columns
and tracking become ordinary tables.

| Today (Mongo)                             | Postgres                                            | Speed                                         |
| ----------------------------------------- | --------------------------------------------------- | --------------------------------------------- |
| `contains` (unanchored `$regex`)          | `ILIKE` + `pg_trgm` GIN index                       | Better: Mongo can't index an unanchored regex |
| Case-insensitive `equals` (`^…$/i` regex) | `lower(data->>'col') = lower($1)` + matching index  | Better, for the same reason                   |
| Number/date comparisons                   | Index on a cast, e.g. `((data->>'price')::numeric)` | About the same                                |
| `$group` for distinct values              | `SELECT DISTINCT`                                   | About the same                                |
| `countDocuments`                          | `count(*)`                                          | The same (both read every matching row)       |
| `skip`/`limit`                            | `OFFSET`/`LIMIT`                                    | The same (both slow on deep pages)            |
| CSV bulk insert                           | `COPY` or multi-row `INSERT`                        | Better                                        |

**Watch out for:**

- **SQL injection.** Mongo filter objects can't be injected, but SQL can. Pass every value as a
  parameter, and accept only column names that exist in the table's column list.
- **Account scoping.** Today each account has its own Mongo database. In Postgres every query
  must filter by `account_id`. Consider row-level security as a backstop.
- **"Indexed" columns** become expression indexes whose cast must match the column type. A type
  change drops and rebuilds the index, as the Mongo code already does.
- **Big tenants.** If one account loads millions of rows, partition `grid_row` by account
  later. It isn't needed now.
- **Rejected for now:** a real Postgres table per user table, with typed columns. It's
  faster, but every column rename or type change becomes an `ALTER TABLE` on live data.
- **Existing data:** a one-off script that copies each `dg:row:*` / `dg:column:*` collection
  into the new tables. Local and demo data can be regenerated instead.

## CSV uploads: separate process, same server

- The processor role (`IS_HORIZON_PRC`) already exists. The API saves the upload to
  `HORIZON_FILE_SHARE` and hands the job over the websocket broker. Locally all four roles run
  in one Node process, so a big upload can slow the API.
- **Deploy it as its own container** next to the API, with a CPU limit. It needs no code
  change.
- **Not a separate server yet.** That would need shared file storage (or object storage), and
  the database, which takes most of an upload's cost, would still be shared. Revisit only if
  uploads visibly compete for CPU.
- **Concurrency bug: fixed** (2026-11-22). `CsvProcessor` kept job state on the singleton,
  and one processor could run two job loops at once. It now keeps per-job state, and the job
  loop runs one job at a time (see HANDOFF).
- Trial caps on rows (`TrackingManager.validate_row_count`) keep uploads bounded.

## Trial and Stripe

- **Before Stripe comes back:** verify signatures on `/webhook/stripe` (it doesn't today), and
  create new keys (the old ones are deliberately not rolled).
- Trial state on the account: `trial_ends_at`, and the plan from Stripe webhooks as the source
  of truth.
- Enforce caps on the server (tables, rows, API calls/month) and show usage in the app.
- Use Stripe Checkout + Customer Portal rather than custom billing pages. Upgrade `stripe` 8 to
  current (HANDOFF step 6).

## Suggested order

1. ~~Fix the `CsvProcessor` concurrency bug.~~ Done 2026-11-22.
2. ~~Decide on Postgres only.~~ Decided 2026-11-22: keep Mongo.
3. Deploy (HANDOFF step 5) with Postgres and Mongo, the API and processor in separate
   containers. Live since 2026-11-22 (`deploy/`); off-site backups still to do.
4. Stripe webhook signatures, then the trial and caps.
5. SSO (HANDOFF 5b) and polish for showing it off.

## Open questions

- Trial length and caps (for example 14 days, 5 tables, 10k rows, 10k API calls)?
- What happens after the trial: read-only, then deleted after N days?
- One price, or a couple of plans?
