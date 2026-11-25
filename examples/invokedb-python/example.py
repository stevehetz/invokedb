"""Reads and writes the example tables that `node examples/setup.mjs` loads.

    INVOKEDB_API_KEY=... python3 example.py [base_url]
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from invokedb import InvokeDBClient  # noqa: E402

base_url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8001/api/v1"
db = InvokeDBClient(os.environ["INVOKEDB_API_KEY"], base_url)

wines = db.table("wine_reviews")
print("wine reviews:", wines.count())

# Search with the shorthand filters, sorted
top = wines.search(
    {"country": {"$eq": "France"}, "points": {"$gte": 90}},
    sort_by="points",
    sort_dir="desc",
    limit=5,
)
for row in top["data"]:
    print(f"  {row['points']}  {row['title']}")

# Query: several filters, sort by several columns, some columns, every page
query = {
    "filters": [
        {"column": "country", "op": "in", "value": ["France", "Italy"]},
        {"column": "points", "op": "gte", "value": 95},
    ],
    "sort": ["-points", "price"],
    "fields": ["title", "points", "price"],
    "limit": 50,
}
print("95+ points from France or Italy:", wines.count(filters=query["filters"]))
for row in wines.query_all(query):
    print(f"  {row['points']}  {row['price']}  {row['title']}")

# Write: add a to-do, tick it off, delete it
todo = db.table("todo")
todo.insert({"name": "Water the plants", "is_complete": "no"})
task = todo.find_one({"name": "Water the plants"})
assert task is not None
todo.update({"_id": task["_id"], "is_complete": "yes"})
todo.delete(task["_id"])
print("added, updated and deleted a to-do")
