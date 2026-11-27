# Pricing: plans, limits and their enforcement (#137)

A review of the plans InvokeDB advertises, the limits stored for them and what the backend
actually enforces, before Stripe comes back (#129). It has four parts: an **audit** (what's
advertised, stored and enforced, and the gaps), a **cost model** (what a customer at each
tier's caps costs on the current server), a **recommendation** (tiers, caps, prices and what
happens on downgrade, lapse and idle), and a **test plan** (an automated test for every limit
of every tier).

**Decided (owner, 2026-11-25): the tiers, caps and prices of 3.2, the behaviour of 3.4 and no
trial (3.3), as recommended**, plus the AI allowances of 3.5. Earlier: a permanent free tier,
very limited, so people can try things out (2026-11-24, on #137); free accounts need no card
and no Stripe customer until they upgrade. #183 enforces the caps of 3.2 from one plan constant
(`core/plan/plans.ts`); #184 brings the read-only state and idle deletion of 3.4.

Line numbers are as of commit `8e89efe` (2026-11-25). Paths are under `packages/horizon-be/src/`
unless they say otherwise.

## 1. Audit

### 1.1 What's advertised, stored and enforced

The pricing page (`packages/horizon-fe/src/view/pages/pricing/pricing.html`) shows **three**
tiers: Free, Basic and Plus. Premium is commented out in both the mobile cards (lines 139–158)
and the desktop table. The cards and the table agree. The "10 / 50 / 100 / 1,000 Tables" that
looked like a mismatch is a commented-out "Trash capacity" row (lines 278–311), so it isn't
shown.

The `subscription` rows come from the migrations `1594251800876-Initial.ts` (lines 93–162),
`1594751365525-SubscriptionUpdate.ts` and `1597933226910-SubscriptionUpdate2.ts`. The test
(`SUB_TEST_*`) and live (`SUB_LIVE_*`) rows are the same. Accounts with no `subscription_id`
get `SUB_FREE` (`core/tracking/tracking.manager.ts:58-68`).

| Limit                   | Free: page / stored | Basic: page / stored | Plus: page / stored   | Premium (hidden): stored | Enforced?                                                                   |
| ----------------------- | ------------------- | -------------------- | --------------------- | ------------------------ | --------------------------------------------------------------------------- |
| Price per month         | $0 / 0              | $9.99 / 9.99         | $29.99 / 29.99        | 99.99                    | No billing (Stripe removed, #6)                                             |
| Tables                  | 3 / 3               | 50 / 50              | 200 / 200             | 5,000                    | Yes, with gaps (1.2)                                                        |
| Rows per table          | 150,000 / 150,000   | 500,000 / 500,000    | 1,000,000 / 1,000,000 | 10,000,000               | Yes, with gaps (1.2)                                                        |
| Columns per table       | 52 / not stored     | 52 / not stored      | 52 / not stored       | not stored               | Hard-coded `52` (`tracking.manager.ts:253`); not effective in the app (1.2) |
| API requests per minute | 50 / 50             | 1,000 / 1,000        | 10,000 / 10,000       | 100,000                  | Per **12 seconds**, not per minute (1.2)                                    |

Limits that aren't on the page and aren't per plan (one value for everyone):

| Limit                         | Value                                                          | Where                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Rows per `/api/v1` write      | 100                                                            | `application/web-file/web-file.service.ts:575`                                                                          |
| Rows per `/api/v1/query` page | 1,000                                                          | `core/web-file/row-query.ts:34` (`max_query_limit()`, line 45, waits for #137)                                          |
| Characters per cell           | 2,000                                                          | `core/web-file/web-file.manager.ts:27`, checked in `validate_row` (line 790)                                            |
| Views per table               | 50                                                             | `core/view/view.ts:37` ("until the plans in #137 set their own")                                                        |
| Forms per account             | 50                                                             | `core/form/form.ts:42` (same comment)                                                                                   |
| Form submissions              | 10 per IP per form, 100 per IP / 10 min; 1,000 per form / hour | `core/form/form.ts:56`                                                                                                  |
| Webhooks per account          | 10                                                             | `core/webhook/webhook.ts:16` (same comment)                                                                             |
| URL import download           | 10 MB, 30 s                                                    | `core/url-import/url-import.ts:7-13`                                                                                    |
| URL sources per account       | none                                                           | no cap; each can sync hourly (`url-import.ts:19-24`)                                                                    |
| CSV upload size               | **none**                                                       | `web/http/web-file/web-file.controller.ts:176-186` (multer, no `limits`); Caddy sets no body limit (`deploy/Caddyfile`) |
| CSV processing time           | 30 minutes                                                     | `constants.ts:4` (`JOB_PROCESSOR_TIMEOUT_MIN`)                                                                          |
| Storage (bytes) per account   | **none**                                                       | rows are capped by count only                                                                                           |
| Rows per account              | **none**                                                       | per table only, so Free allows 3 × 150k = 450k rows                                                                     |
| API calls per month           | **none**                                                       | only the per-window count                                                                                               |

### 1.2 How each limit is enforced, and the gaps

**Tables** (`validate_table_count`, `tracking.manager.ts:127-141`). Counts the account's
non-deleted `type: 'file'` rows in Postgres and refuses (403 "Table limit exceeded") when one
more would pass `max_tables`. Called from `FileDirectoryService.create`
(`application/file-directory/file-directory.service.ts:126`), which every way of making a table
goes through: a new table in the app, a CSV upload (`web-file.controller.ts`), a template
(`application/table-template/table-template.service.ts`) and a URL import
(`application/url-import/url-import.service.ts:90`). Gaps:

- **Race:** count then insert, with nothing atomic in between. Parallel creates can all pass
  the check and go over the cap.
- **Locks:** after a table is deleted (`file-directory.service.ts:222`) or the plan changes,
  `update_account_lock` (`tracking.manager.ts:160-178`) locks the account when it's over the
  table cap and **unlocks it otherwise**. The account has one `locked` flag and a free-text
  reason, so this would also lift a lock set for any other reason (a lapsed payment, abuse).

**Rows per table** (`add_rows` → `validate_add_row_count`, `tracking.manager.ts:89-96`,
`285-290`). Counts the table's rows with `countDocuments()` and refuses (403 "Row count limit
exceeded") when the batch would pass `max_rows`. Paths:

| Path                                              | Checked?                                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| App: add rows (`POST /web-file/batch_create/...`) | Yes, `web-file.service.ts:755` (`batch_create`)                                                                                 |
| App: new table's 3 starter rows                   | Yes, `core/web-file/web-file.manager.ts:426`                                                                                    |
| `/api/v1` create                                  | Yes, through `batch_create` (`web-file.service.ts:476`)                                                                         |
| Public form submission                            | Yes, through `batch_create_internal` (`web-file.service.ts:741`)                                                                |
| Template rows                                     | Yes, through `batch_create` (the table is deleted again if they don't fit)                                                      |
| CSV upload                                        | Yes, the file's line count before processing (`core/web-file/csv-processor.ts:69`); the table is new, so its count is the total |
| URL import and re-sync                            | Yes, `core/web-file/url-sync-processor.ts:185`, `195`; recount after (line 274)                                                 |

Gaps:

- **Race:** count then insert again. Two 100-row API writes at 99,950 rows both pass.
- **Cost:** `countDocuments()` with no filter scans the whole collection, on every write batch
  and every delete (`deleted_rows`, line 273). On a 1M-row table that's a full scan per API
  write. `estimatedDocumentCount()` (collection metadata) or an `$inc` counter would be O(1).
- **Dead counter:** `tracking:row_count` is written (`update_row_count`, line 84) but never
  read for enforcement; it can drift harmlessly. Either use it (atomically) or drop it.
- **Per table only:** there's no account-wide row or storage cap, so the cost of an account is
  `max_tables × max_rows × row size`, unbounded in bytes (52 columns × 2,000 characters is up
  to ~100 KB per row).
- **At the limit:** writes that would pass the cap are refused with 403; nothing is locked. A
  table is only _locked_ (`update_table_lock`, line 114) when it's already over the cap after a
  delete, a re-sync or a plan change (`update_account_table_locks`, line 180). A locked table
  refuses edits, updates and `/api/v1` calls (`check_table_lock`, line 258) but the app still
  reads it.

**Columns** (`validate_column_count`, `tracking.manager.ts:246-256`). A hard-coded 52, not a
plan value. Paths:

| Path                                                                                                                                        | Checked?                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| App: save columns (`PUT /web-file/batch_update[_job]/data_grid_column/...`, which the grid uses to add, rename, retype and reindex columns) | **Not effectively.** `add_columns` (line 292) calls `validate_column_count` without `await` (#152, #163)                                    |
| App: save one column (`PUT /web-file/:id/data_grid_column/...`)                                                                             | **No** (`web-file.service.ts:662-676`)                                                                                                      |
| App: create columns (`POST /web-file/batch_create/data_grid_column/...`)                                                                    | **No** (`web-file.service.ts:749-751`)                                                                                                      |
| App: "add column" placeholder (`GET /web-file/:id/get_new_column`)                                                                          | **No**, and no account lock check; each call inserts a `deleted: true` placeholder (`web-file.manager.ts:39-56`), so they pile up unbounded |
| CSV upload                                                                                                                                  | Yes (`csv-processor.ts:141`)                                                                                                                |
| URL re-sync adding columns                                                                                                                  | Yes (`url-sync-processor.ts:95`)                                                                                                            |
| Column type change (a `COLUMN_UPDATE` job)                                                                                                  | Adds no column; same non-awaited check as "save columns"                                                                                    |

Two more problems with "save columns", which matter for the fix of #152/#163:

- The grid sends **every** column on save (`packages/horizon-fe/src/components/h-data-grid/data-grid-manager.js:144-170`),
  and `batch_update` counts all of them as new (`web-file.service.ts:692`). With the `await`
  added and nothing else, the check would compute existing + all = twice the column count, so
  saving columns on any table with more than 26 would be refused. The fix must count only the
  columns that aren't saved yet (new ids, or ones going from `deleted: true` to `false`).
- Today the rejected promise is unhandled. Node 22's default for unhandled rejections is to
  throw, and there's no `process.on('unhandledRejection')` in the backend, so saving columns on
  a table with 27+ columns may crash the API process (Docker restarts it). Not reproduced here
  (no database); worth checking first.

**API requests** (`update_req_count`, `tracking.manager.ts:201-237`). Called on every `/api/v1`
call: get, query, count, create, update, delete (`web-file.service.ts:277`, `357`, `444`,
`481`, `521`). Not called on the app's own routes, which is right. Gaps:

- **Wrong window:** `req_time_limit_min = 0.2` (line 213) is 12 seconds, so "50 per minute"
  really allows 250 per minute, and Plus's "10,000 per minute" allows 50,000.
- **Race:** `findOne` then `updateOne` with the old count; parallel calls all read the same
  count and one increment wins. A burst of concurrent calls isn't limited. An atomic
  `findOneAndUpdate` with `$inc` (or the in-memory `RateLimiter` in
  `web/http/_rate-limit/rate-limit.ts`, since there is one API process) fixes it.
- **Cost:** three Mongo round trips per call (limits, read, write) before any work.
- **Null means unlimited:** a plan with `max_requests_per_minute` null skips the check (line
  204). Plus and Premium started that way and were changed later; a bad row would silently make
  a tier unlimited.
- **No monthly quota.** A free account can make ~10.8M calls a month at the real rate today.
- **At the limit:** 403 "External API request limit exceeded". It should be 429 with a
  `Retry-After`, like the other rate limits (#133).

**Plan changes** (`SubscriptionService.on_subscription_change`,
`application/subscription/subscription.service.ts:27-34`). Copies the plan's limits into the
account's `tracking:limits` document, then re-locks. It's **never called** (Stripe was the only
caller). The limits are copied once, on first use (`get_limits`, line 70), so changing a
`subscription` row (a migration) doesn't reach accounts that already have a copy. Two sources
of truth that drift; reading the plan directly (it's one indexed Postgres row, or a constant)
would remove the copy.

**Account lock** (`check_account_lock`, line 266). Checked on most writes and reads in the app
and `/api/v1`, except `/api/v1/delete` (#172) and `get_new_column`. The message is built as
`` `Account locked: ${reason}` || 'Account is locked' ``, so the fallback never applies.

**Self-service plan change:** `AccountUpdateDto` has a `subscription_id`
(`application/account/dto/account-update.dto.ts:10`), but the route only passes on the names
(`web/http/account/account.controller.ts:32`). Safe today; drop the field so it stays safe.

### 1.3 Is usage shown?

No. The Account page's Subscription box
(`packages/horizon-fe/src/components/account/subscription-form/subscription-form.html`) shows
the plan name and price and, if the account is locked, the reason. Nothing shows tables used of
the cap, rows per table, API calls or storage. Locked tables show a lock in the tree
(`components/h-tree/h-tree.js:62`). Someone hits a limit only as a 403 toast.

`GET /subscription/plan-tiers` (`web/http/subscription/subscription.controller.ts:15-19`)
returns the enabled rows for the account's `stripe_env_id`. Nothing sets that column on new
accounts, and TypeORM 1.x refuses a null or undefined where value, so for them the route most
likely errors. The pricing page doesn't use it; its numbers are hard-coded. The plan constant
of 3.1 replaces it.

## 2. Cost model

All figures are estimates for planning, not measurements; the owner can check them against
production with `db.stats()` per `horizon:acct_<id>` database.

### 2.1 The server

| Droplet (DigitalOcean Basic) | Price with weekly backups (+20%) | Mongo cache (`MONGO_CACHE_GB`) | Disk   |
| ---------------------------- | -------------------------------- | ------------------------------ | ------ |
| 2 vCPU / 4 GB (today)        | ~$29                             | 0.75 GB                        | 80 GB  |
| 4 vCPU / 8 GB                | ~$58                             | 2 GB                           | 160 GB |
| 8 vCPU / 16 GB               | ~$115                            | 6 GB                           | 320 GB |

Prices from `docs/INFRASTRUCTURE_PLAN.md` (checked 2026-11-22) and DigitalOcean's list prices;
re-check before deciding. Other costs: Spaces for the nightly off-site backups ($5/month for
250 GB, `deploy/backup.sh`, 30 days kept), Mailgun (transactional email only: verification,
resets, warnings; a few cents per thousand), and Stripe's 2.9% + $0.30 per charge, which is a
large share of a small price ($0.59 of $9.99).

What's usable on today's box: of 80 GB, the OS, images, logs and uploads' temp files take
~15 GB, and Mongo needs headroom to compact, so plan on **~30 GB of Mongo data**. Of 4 GB RAM,
Postgres, two Node processes and Caddy take ~2 GB; Mongo's cache is 0.75 GB.

### 2.2 What a row costs

A typical row (10 columns of short text and numbers; the field names are single letters,
`a`, `b`, …) is ~300 bytes of BSON, ~150 bytes on disk with WiredTiger's compression, plus
~20 bytes of `_id` index and more for each indexed column. Call it **0.2 KB on disk and
0.3 KB in cache**. A worst-case row (52 columns × 2,000 characters) is ~100 KB.

| Per 1M typical rows | Amount                             | Cost on today's box                                      |
| ------------------- | ---------------------------------- | -------------------------------------------------------- |
| Disk                | ~200 MB                            | ~$0.20/month (200 MB of ~30 GB usable, of $29)           |
| Cache, if all hot   | ~300 MB                            | 40% of the 0.75 GB cache; ~$5/month of RAM if always hot |
| Off-site backups    | ~75 MB gzipped × 30 days = ~2.3 GB | well inside Spaces' 250 GB                               |

Each **table** also costs something whatever its size: two collections (rows, columns), each
with at least an `_id` index, so 4+ WiredTiger files, ~16 KB+ on disk and a data handle in RAM
when open. Mongo slows down past some tens of thousands of collections. 1,000 free accounts
with 3 tables each is 12,000 files; 10,000 is 120,000. **The number of tables on the server,
not their rows, is what free accounts cost**, so idle free accounts must be cleaned up.

### 2.3 What an API call and an upload cost

An `/api/v1` call today makes ~6–8 database round trips (account lock, three for the request
count, table lock, columns, the query). Assume the API process does **~300 simple calls a
second** on one vCPU of today's box (to be measured; `scripts/api-smoke.mjs` gives a feel).
At a comfortable 30% load that's ~250M calls a month for the whole server, so **a million calls
cost ~$0.06**. The monthly volume is cheap; bursts are what hurt, so a per-second rate limit
matters more than the monthly quota.

A CSV upload runs in the `prc` container on one CPU (`PRC_CPUS`), in batches of 10,000 rows;
roughly 10,000–20,000 rows a second, so 1M rows is 1–2 minutes of one CPU. One upload at a
time per container; a large upload delays everyone's. Without a size limit, the temp file can
also fill the disk.

### 2.4 Today's tiers at their caps

| Tier (today) | Max rows (tables × rows per table) | Typical disk | Worst-case disk | Hits the server first                                                                             |
| ------------ | ---------------------------------- | ------------ | --------------- | ------------------------------------------------------------------------------------------------- |
| Free         | 3 × 150k = 450k                    | ~90 MB       | ~45 GB          | One worst-case free account fills the disk                                                        |
| Basic, $9.99 | 50 × 500k = 25M                    | ~5 GB        | ~2.5 TB         | Disk: 6 maxed accounts fill it; cache: one busy account                                           |
| Plus, $29.99 | 200 × 1M = 200M                    | ~40 GB       | ~20 TB          | One maxed account doesn't fit; its API cap (10k/min, really 50k/min, ~830/s) is over the server's |
| Premium      | 5,000 × 10M = 50B                  | ~10 TB       | —               | Not sellable on one server                                                                        |

So today's caps can't be sold as they are: per-table row caps multiplied by table caps leave
every tier, Free included, unbounded in practice, and the API caps of the upper tiers are more
than the server.

## 3. Recommendation

### 3.1 Principles

- **Cap the account, not the table.** Rows per account (all tables together) and storage per
  account (bytes, from `dbStats` on the account's own database, which is cheap) bound what an
  account costs. Keep a per-table row cap only as a safety net.
- **Two paid tiers, not three.** Fewer numbers to test and explain; a "contact us" line for
  more. A Team tier waits for workspaces (#150).
- **A monthly API quota plus a per-second rate limit.** The quota is what people buy; the rate
  limit protects the server.
- **Refuse, don't delete.** At a cap, writes get a clear error; reads keep working. Data is only
  deleted after warnings, for idle free accounts.
- **Plans in code, not in a table.** One constant (`core/plan/plans.ts`) with every cap per
  tier, used by the backend, served to the pricing page and the usage display, and unit-tested.
  Stripe only maps a price id to a plan id. The `subscription` table can then go with the other
  Stripe leftovers.

### 3.2 Tiers and caps (decided 2026-11-25)

| Cap                                   | Free                | Starter                 | Pro                       |
| ------------------------------------- | ------------------- | ----------------------- | ------------------------- |
| Price                                 | $0, no card         | **$9/month** ($90/year) | **$29/month** ($290/year) |
| Tables                                | 3                   | 25                      | 100                       |
| Rows per account (all tables)         | 3,000               | 100,000                 | 1,000,000                 |
| Rows per table                        | 1,000               | 100,000                 | 1,000,000                 |
| Storage per account                   | 10 MB               | 1 GB                    | 5 GB                      |
| Columns per table                     | 20                  | 52                      | 52                        |
| API calls per month                   | 10,000              | 250,000                 | 2,000,000                 |
| API rate limit (per account)          | 2/s, bursts of 10   | 10/s, bursts of 50      | 25/s, bursts of 100       |
| Rows per `/api/v1` write / query page | 100 / 100           | 100 / 1,000             | 100 / 1,000               |
| CSV upload size                       | 1 MB                | 25 MB                   | 100 MB                    |
| URL imports (sources)                 | 1, daily sync only  | 5, hourly               | 25, hourly                |
| Webhooks                              | 1                   | 5                       | 10                        |
| Forms                                 | 1                   | 10                      | 50                        |
| Views per table                       | 5                   | 50                      | 50                        |
| Audit log kept (#217)                 | 7 days              | 30 days                 | 90 days                   |
| Per-key rate limits, request logs     | —                   | Yes                     | Yes                       |
| Two-factor sign-in, data export       | Yes                 | Yes                     | Yes                       |
| Idle deletion                         | After 6 months idle | Never while paid        | Never while paid          |

Plus a server-wide CSV upload limit of 100 MB at the HTTP layer (multer `limits.fileSize`),
whatever the plan, so a request can't fill the disk before the plan is checked.

**Dashboards** (#209) were removed on 2026-11-25 (owner's decision, #264), so they have no tier limits.

Why these numbers:

- **Free** is enough to build a small app against the API (a few tables, a form, a webhook)
  and too small to host anything real. It costs ~$0.01/month in disk at its 10 MB cap; its real
  cost is its ~12 Mongo files, which idle deletion bounds. 1,000 active free accounts would cost
  ~$5–15/month. Email verification (#132) and the signup rate limits (#133) keep spam signups
  down.
- **Starter**, at its caps: storage ≤1 GB (~$1 of disk), 100k rows (~30 MB if all hot, ~$0.50
  of cache), 250k calls (~$0.02), backups (cents): **~$1.50 worst case** against **$8.44**
  after Stripe's fee. ~80% margin.
- **Pro**, at its caps: storage ≤5 GB (~$4 on today's box), 1M rows all hot (~300 MB, 40% of
  today's cache, ~15% of the 8 GB box's: ~$5–9), 2M calls (~$0.12), backups (~$0.10): **~$10–13
  worst case** against **$27.86**. ~55% margin at the worst, ~90% for a typical customer whose
  hot set is a fraction of their rows.
- **Where the server runs out:** with these caps, today's box carries ~25 maxed Starter
  accounts or ~5 maxed Pro accounts before disk is tight, and the Mongo cache is the first thing
  to hurt once 2–3 Pro customers are busy at once. Move to the 8 GB box (`MONGO_CACHE_GB=2`,
  `PRC_CPUS=2`) at the first ~3 Pro customers or 30 GB of data, whichever comes first; that's
  covered by one Pro subscription. The 16 GB box carries ~10× today's.
- **52 columns** stays: column keys and the grid are built around it, and it's not a cost
  driver once storage is capped.

### 3.3 A trial on top?

Decided: **no trial at launch.** The free tier is the trial; it avoids `trial_ends_at` and
a third state to test. If conversion is low later, add a 14-day Pro trial that needs no card and
ends back on Free (with the "over the caps" rule below).

### 3.4 What happens when…

| Event                                          | Behaviour                                                                                                                                                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A write would pass a cap                       | Refused: 403 with a code (`plan_limit`, which limit, the cap, an upgrade link); nothing written.                                                                                                                                 |
| The monthly API quota is used up               | `/api/v1` answers 429 until the 1st (UTC) or an upgrade; the app keeps working. Email at 80% and 100%.                                                                                                                           |
| The rate limit is hit                          | 429 with `Retry-After`.                                                                                                                                                                                                          |
| Upgrade                                        | New caps at once (Stripe webhook); locks lifted.                                                                                                                                                                                 |
| Downgrade                                      | At the end of the paid period. If the account is over the new caps it becomes **read-only**: reads, exports and deletes work, writes are refused, until it's under the caps or upgrades. Nothing is deleted.                     |
| Payment fails (lapse)                          | Stripe's retries plus a **14-day grace period** with full access and a banner; then treated as a downgrade to Free (read-only if over Free's caps).                                                                              |
| Cancel                                         | Keeps the plan to the end of the paid period, then as a downgrade to Free.                                                                                                                                                       |
| Free account idle (no sign-in and no API call) | Email at 5 months, again a week before 6 months, then the account and its data are deleted. A lapsed paid account that's over Free's caps follows the same rule from its lapse date, with the warnings saying what will be lost. |

"Read-only" needs its own flag (a plan state on the account), separate from the existing
`locked` flag, so lifting one doesn't lift the other (1.2, "Locks").

### 3.5 AI features (decided 2026-11-25)

"Ask your data" (#149, PR #188) and AI rows and tables (#148, PR #186) call the Anthropic API,
so each use costs real money. **Decided (owner, 2026-11-25):** the AI features are capped per
tier so that an account using its whole allowance costs at most ~10% of its plan's price, and
every tier uses Haiku. (A paid Sonnet add-on was planned, #224, and **dropped on 2026-11-27**.)

**What a use costs** (estimates from how #188 builds a request; check them against
`tracking:ai_usage`, which records tokens, before changing a cap). A question is about two
model calls, ~8k input and ~1k output tokens. Generating rows is mostly output.

| Model                          | $/M tokens (in / out) | Per question | Per 100 generated rows |
| ------------------------------ | --------------------- | ------------ | ---------------------- |
| `claude-haiku-5-5` (default)   | $0.10 / $0.50         | ~$0.0015     | ~$0.003                |
| `claude-sonnet-5-5` (not used) | $2 / $10              | ~$0.025      | ~$0.05                 |
| `claude-opus-5-5` (not used)   | $4 / $20              | ~$0.05       | ~$0.10                 |

**Allowances** (per account per UTC month, verified accounts only; an unverified account gets
none):

| AI allowance                | Free   | Starter | Pro    |
| --------------------------- | ------ | ------- | ------ |
| Model                       | Haiku  | Haiku   | Haiku  |
| Questions (#149)            | 10     | 300     | 2,000  |
| Generated rows (#148)       | 50     | 1,000   | 10,000 |
| AI cost budget (dollars)    | $0.05  | $1      | $5     |
| Worst-case cost at the caps | ~$0.02 | ~$0.50  | ~$3.30 |

- **One model for everyone:** `HORIZON_AI_MODEL` (Haiku), so a model change is an env change,
  not a deploy.
- **Two caps per account:** the count (what the app shows: "7 of 10 questions") and the cost
  budget, worked out from the tokens each call used and the model's price. Whichever is hit
  first refuses the next use (429 with a code, like the API quota). The cost budget stops long
  prompts or a model change from breaking the maths.
- **A server-wide monthly AI budget** (`HORIZON_AI_MONTHLY_BUDGET_USD`, $20 to start): Telegram
  at 50%, 80% and 100%; at 100% the AI features answer 503 for everyone until the 1st (UTC),
  and the app hides the AI buttons. The Anthropic Console spend limit on the key is the last
  backstop, set below what the owner is willing to lose in a month.
- **Per request:** `max_tokens` capped, low effort, a fixed maximum of turns, at most 3 sample
  rows in the prompt, the schema prompt cached. Rows per generate request stay capped (#186's
  `AI_LIMITS`).
- The PRs' tier names (FREE, BASIC, PLUS, PREMIUM) become Free, Starter and Pro, and the caps
  live in the one plan constant from #183.

## 4. Test plan

Every limit of every tier gets automated tests. Two kinds:

- **Unit tests** (`core/tracking/tracking.manager.spec.ts`, new; and `core/plan/plans.spec.ts`
  for the plan constants): the counting and the limit maths, with the Mongo and Postgres calls
  mocked. Each tier's numbers are read from the plan constant, so a test runs for Free, Starter
  and Pro alike (`describe.each`).
- **API smoke checks** (`scripts/api-smoke.mjs`): hitting each limit is refused on every path.
  To keep it fast, `scripts/smoke-env.sh` sets a test-only env var (e.g. `HORIZON_TEST_PLANS`,
  never set in production, like `HORIZON_WEBHOOK_TEST_HOSTS`) that shrinks the caps (Free: 2
  tables, 5 rows, 3 columns, 5 API calls/month, 1 KB upload…), plus a test-only route or seed to
  put the smoke accounts on Free, Starter and Pro.

| Limit                               | Unit tests                                                                                                                  | Smoke checks (each path must be refused at the cap, and allowed just under it)                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables                              | at cap − 1 allowed, at cap refused, per tier; folders and deleted tables not counted; concurrent creates can't pass the cap | app new table; CSV upload; template; URL import; 3 parallel creates at cap − 1 make exactly 1                                                         |
| Rows per account                    | sum over tables; batch that crosses the cap refused whole; deletes free room; concurrent writes                             | app add rows; `/api/v1/create`; form submission; template rows; CSV upload; URL import; URL re-sync (replace and upsert)                              |
| Rows per table                      | same, per table                                                                                                             | the same paths on one table                                                                                                                           |
| Storage                             | bytes from `dbStats`; refused over the cap; cached for a short time                                                         | a write that crosses the (tiny test) cap via app and `/api/v1`; a CSV that would                                                                      |
| Columns                             | only new columns count (an edit of all 30 columns isn't 60); deleted and placeholder columns not counted; per tier          | app save columns; app save one column; app create columns; CSV with too many headers; URL re-sync adding columns; a column type change doesn't count  |
| API calls per month                 | `$inc` per call; resets on the 1st (UTC); app routes don't count; refused at the cap                                        | `/api/v1` get, query, count, create, update, delete each counted and refused (429) at the cap; app routes still work                                  |
| API rate limit                      | window maths with a fake clock; bursts; per account, not per key                                                            | a burst over the limit gets 429 with `Retry-After`                                                                                                    |
| Query page / write size             | per tier                                                                                                                    | `/api/v1/query` with `limit` over the cap → 400; write of 101 rows → 400                                                                              |
| CSV upload size                     | —                                                                                                                           | a file over the tier's cap is refused before processing (413) and leaves no table and no temp file; over the server-wide cap too                      |
| URL sources, webhooks, forms, views | count per tier                                                                                                              | the next one is refused at each tier's cap                                                                                                            |
| Usage display                       | the usage numbers (`GET /usage` builder)                                                                                    | `GET /usage` matches what was created; another account's isn't visible                                                                                |
| Downgrade                           | a downgraded account over the caps is read-only; under them it isn't                                                        | Pro → Free with too many rows: reads, export and delete work; create, update, column change, upload refused; deleting down to the cap restores writes |
| Lapse                               | grace period end → Free state; the `locked` flag is untouched                                                               | an account past its grace period behaves as a downgraded one                                                                                          |
| Idle free accounts                  | who's idle (last sign-in, last API call), warning dates, paid accounts never                                                | (a job test with a fake clock in unit tests; no smoke check deletes data)                                                                             |
| AI allowances (3.5)                 | count and cost caps per tier; server-wide budget; unverified gets none                                                      | with the Anthropic stub: each tier refused at its count cap and at its cost cap; generate rows refused on Free; global budget reached → 503           |
| Free tier                           | every cap above at Free's values                                                                                            | the smoke's Free account hits each tiny cap above                                                                                                     |

## 5. Changes needed

Filed as issues (labelled `agent-found`; the owner triages):

- #182: close the enforcement gaps in `TrackingManager` (races, the 12-second window, the column
  counting, the missing column checks, the scan per write, the upload size limit, the shared
  lock flag), with the unit tests above. Builds on #152 / #163 (the missing `await`) and #172
  (`/api/v1/delete` lock).
- #183: per-plan limits from one plan constant, account-wide row and storage caps, the monthly
  API quota and rate limit, `GET /usage` and a usage display on the Account page, and the
  pricing page built from the plan data, with the smoke checks above. Waits for the owner's
  decision on the numbers.
- #184: the read-only state for over-the-cap accounts, and idle free accounts warned and
  deleted. Waits for the owner's decision.

#275 dropped `subscription_id` from `AccountUpdateDto` and `GET /subscription/plan-tiers`;
`GET /auth/authorize` answers `plan: { id, name, internal }` from the plan constant, which the
account menu shows. Still to go: the `subscription` table and `tracking:limits` (can go with
#129).

#129 (Stripe) shipped in #310 (2026-11-26): plans map to Stripe prices by **lookup key**
(`core/billing/billing.ts`); the webhook sets the plan from the customer's subscriptions and
`PlanStateService` works out the read-only state; no Stripe customer until the first upgrade;
the downgrade, lapse (14-day grace) and cancel rows of 3.4. Off in production until the
business is set up (`docs/GO_LIVE.md`).
