# InvokeDB Python client

A small, typed client for the InvokeDB table API, the Python counterpart of the JavaScript client
in [`../invokedb-node`](../invokedb-node). It uses only the standard library (`urllib`), so it has
no dependencies, and runs on Python 3.9+.

There's no public InvokeDB API at the moment, so the client defaults to a local backend at
`http://127.0.0.1:8001/api/v1` (`npm run dev` from the repo root). It isn't on PyPI; install it
from this folder:

```sh
pip install ./examples/invokedb-python    # or: pip install -e ./examples/invokedb-python
```

## Usage

Get an API key from the Account page (http://127.0.0.1:8000/app/account), or run
`node examples/setup.mjs` from the repo root, which loads the example tables and writes a key to
`examples/angular/public/invokedb.config.json`. `example.py` uses those tables:
`INVOKEDB_API_KEY=... python3 example.py`.

```python
import os
from invokedb import InvokeDBClient, InvokeDBError

db = InvokeDBClient(os.environ["INVOKEDB_API_KEY"])
# Or point it somewhere else: InvokeDBClient(api_key, "https://…/api/v1", timeout=30)

wines = db.table("wine_reviews")

# Get rows: {"count": total, "data": [{"_id": ..., **columns}]}
page = wines.get(skip=0, limit=20, sort_by="points", sort_dir="desc")

# Search, sort and page
top = wines.search(
    {
        "country": {"$eq": "France"},
        "price": [{"$gte": 20}, {"$lte": 60}],  # several conditions on one column
        "points": {"$gte": 90},
    },
    sort_by="points",
    sort_dir="desc",
    limit=10,
)
first = wines.find_one({"title": {"$ctn": "Riesling"}})  # a row or None
total = wines.count()

# Query: several filters, sort by several columns, only some columns, cursor paging
query = {
    "filters": [
        {"column": "country", "op": "in", "value": ["France", "Italy"]},
        {"column": "points", "op": "gte", "value": 90},
        {"column": "designation", "op": "empty", "value": False},
    ],
    "sort": ["-points", "price"],  # "-" for descending
    "fields": ["title", "points", "price"],
    "limit": 50,
}
res = wines.query(query)  # {"data": [...], "next_cursor": ...}
while res["next_cursor"]:
    res = wines.query(query, cursor=res["next_cursor"])  # keywords add to (or override) the dict
for row in wines.query_all(query):  # or let the client follow the cursor
    print(row["title"])
french = wines.count(filters=[{"column": "country", "op": "eq", "value": "France"}])

# Write
todo = db.table("todo")
todo.insert({"name": "Water the plants", "is_complete": "no"})  # or a list of rows
task = todo.find_one({"name": "Water the plants"})
todo.update({"_id": task["_id"], "is_complete": "yes"})  # only the columns you pass change
todo.delete(task["_id"])  # or a list of _ids

# Link columns: rows instead of ids
orders = db.table("orders").get(expand=["customer"])

try:
    db.table("nope").get()
except InvokeDBError as e:
    print(e.status, e.message, e.body)
```

| Method                                                        | Endpoint              | Returns                    |
| ------------------------------------------------------------- | --------------------- | -------------------------- |
| `get(skip=, limit=, sort_by=, sort_dir=, expand=)`            | `GET /get`            | `{count, data}`            |
| `search(filter, skip=, limit=, sort_by=, sort_dir=, expand=)` | `POST /search`        | `{count, data}`            |
| `find_one(filter=None)`                                       | `/get`, `/search`     | a row or `None`            |
| `query(query=None, expand=, **query_keys)`                    | `POST /query`         | `{data, next_cursor}`      |
| `query_all(query=None, expand=, **query_keys)`                | `POST /query`         | an iterator over every row |
| `count()`, `count({filters, match})`, `count(filters=...)`    | `/get`, `POST /count` | `int`                      |
| `insert(row_or_rows)`                                         | `POST /create`        | the response body          |
| `update(row_or_rows)`                                         | `PUT /update`         | the response body          |
| `delete(id_or_ids)`                                           | `POST /delete`        | the response body          |

`search` filters: `$eq`, `$ctn` (contains, case-insensitive), `$gt`, `$gte`, `$lt`, `$lte`, and
`$or` across columns; a plain value means `$eq`. `query` and `count` filters are
`{"column", "op", "value"}` with the ops `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in` (a list),
`contains` (case-insensitive unless `"case": "sensitive"`) and `empty` (`True` or `False`); all
must match, or any with `"match": "any"`. The types (`Query`, `QueryFilter`, `CountQuery`,
`FindResult`, `QueryResult`) are `TypedDict`s, and the package ships `py.typed`.

Date columns come back as ISO 8601 strings in UTC with milliseconds (`"2026-11-28T12:01:29.123Z"`;
`datetime.fromisoformat` reads them on Python 3.11+, or replace the `Z` with `+00:00` first). Send
a date as ISO 8601 (`"2026-11-28T12:01:29.123Z"`, or just `"2026-11-28"`); what you write is what
you read back.

Failed requests raise `InvokeDBError` with `status` (0 if the server couldn't be reached),
`message` and the response `body`.

### From the API docs

Each table's API docs in the app show every request as curl, fetch and
Python (`urllib`, so they run without installing anything). With this client, the same request
is a method call with the snippet's body:

| Docs endpoint | Client call                                  |
| ------------- | -------------------------------------------- |
| Get rows      | `table.get(skip=0, limit=10)`                |
| Search        | `table.search(<the body>, skip=0, limit=10)` |
| Query         | `table.query(<the body>)`                    |
| Count         | `table.count(<the body>)`                    |
| Create        | `table.insert(<the body>)`                   |
| Update        | `table.update(<the body>)`                   |
| Delete        | `table.delete(<the body>)`                   |

`tests/test_live.py` runs every request in a table's generated docs through the client this way.

## Tests

```sh
cd examples/invokedb-python
python3 -m unittest discover -s tests -v                                       # offline (a stub server)
INVOKEDB_TEST_BASE=http://127.0.0.1:8001 python3 -m unittest discover -s tests -v  # and a backend
```

The offline tests (`tests/test_client.py`) check each request the client sends and how it reads
the answers. The live tests (`tests/test_live.py`) run only when `INVOKEDB_TEST_BASE` is set (the
backend's root URL, without `/api/v1`): they sign in as `INVOKEDB_TEST_EMAIL` /
`INVOKEDB_TEST_PASSWORD` (by default the local demo login), make their own API key and a small
`py_client_<random>` table, call every method, then delete the table and revoke the key. Point
them at a throwaway backend such as the smoke stack (`bash scripts/smoke-env.sh`, port 8101).

## Publishing

Not published. To publish when asked, from this folder: `python3 -m build && twine upload dist/*`.
