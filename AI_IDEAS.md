# AI Integration Ideas

Short list of AI features worth building into InvokeDB. Default model: Claude (Anthropic API),
called from `horizon-be` only. The API key never reaches the browser.

## 1. Generate dummy data

Fill a table with realistic fake rows.

- **UI:** "Generate rows" button in the grid toolbar → prompt box ("50 US customers with
  signup dates in 2025") + row count.
- **How:** send the table's column names/types + a few sample rows + the prompt. Ask for JSON
  rows through a tool schema built from the columns, so output always matches the table.
- **Bonus:** "New table from prompt" creates the columns too ("a CRM for a dog groomer").
- **Limits:** cap rows per request (batch large counts), count usage against the plan.

## 2. Edit data with natural language

Describe a change; AI proposes it, the user approves.

- **Examples:** "title-case every name", "fill missing `state` from `city`", "split `full_name`
  into first/last", "tag each row's `sentiment` from `review`".
- **How:** for structural or rule-based edits, have the model write a filter + update spec
  (or a small transform) that the backend runs over all rows. For per-row judgement
  (classify, summarise, translate), send rows in batches.
- **Safety:** always show a diff preview in the grid before applying, and keep an undo
  snapshot.

## 3. Other ideas

- **Ask your data:** chat question → model writes a query against the table's API → answer +
  a highlighted result in the grid.
- **AI column:** a column whose value is a prompt over other columns ("summarise `notes`"),
  filled per row and refreshed on edit.
- **Data cleanup:** scan a table and flag duplicates, bad emails, inconsistent formats, with
  one-click fixes.
- **Import helper:** paste messy CSV/text → model maps it to columns and types.
- **API snippet helper:** "how do I fetch rows where price > 10 in Python?" → ready-to-run code
  for this table's endpoint.

## 4. New things built on top of tables

Each new type lives in the file directory next to tables and reads or writes through the same
table API, so access control and API keys carry over.

- **Forms:** choose a table and get a shareable form that inserts a row (sign-ups, surveys,
  bug reports). AI drafts the form from the columns or from a prompt ("RSVP form for a
  wedding") and can suggest validation rules.
- **Diagrams / charts:** a view that reads one or more tables, such as a bar chart, kanban
  board, calendar or map. "Show signups per month as a line chart" → AI picks the table,
  query and chart type.
- **Schema diagram:** draw the tables and the links between them (shared ids). AI suggests
  relationships it detects.
- **Dashboards:** a page of charts, tables and stat tiles, each backed by a table query,
  shareable by link.
- **Mini apps:** form + list + detail view over a table (a simple CRM or inventory tracker),
  generated from a prompt. This could grow into a small no-code app builder.

Shared idea: every view stores only a **reference** (table id + query + layout config), never
a copy of the data, so it stays live as the table changes.

## Shared building blocks

- One `ai` module in `horizon-be` (`src/application/ai`) wrapping the Anthropic SDK: prompts,
  JSON/tool output, retries, per-account usage tracking.
- Reuse the existing row bulk-write path for inserts/updates.
- A preview → apply pattern in the grid for anything that changes data.

## Suggested order

1. Dummy data (smallest, safe: only adds rows)
2. Natural-language edits with preview
3. Forms (the easiest new type: they just insert rows)
4. Charts/dashboards, then AI column and "ask your data"
