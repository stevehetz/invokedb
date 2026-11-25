"""Live tests: the client against a running InvokeDB backend. Skipped unless
INVOKEDB_TEST_BASE is set, so `unittest discover` runs offline by default.

    INVOKEDB_TEST_BASE=http://127.0.0.1:8001 python3 -m unittest discover -s tests -v

They sign in (INVOKEDB_TEST_EMAIL / INVOKEDB_TEST_PASSWORD, by default the local demo
login), make an API key and a small table of their own, call every method against it, run
each request in the table's generated API docs through the client, then delete the table
and revoke the key. The user's own tables are never touched.
"""

from __future__ import annotations

import json
import os
import sys
import time
import unittest
import urllib.error
import urllib.request
import uuid
from typing import Any, Dict, Optional
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from invokedb import InvokeDBClient, InvokeDBError, InvokeDBTable  # noqa: E402

BASE = (os.environ.get("INVOKEDB_TEST_BASE") or "").rstrip("/")
EMAIL = os.environ.get("INVOKEDB_TEST_EMAIL") or "demo@invokedb.com"
PASSWORD = os.environ.get("INVOKEDB_TEST_PASSWORD") or "password"

CSV = "name,age,city\nalice,30,Paris\nbob,41,Rome\ncarol,25,Paris\n"


def call(
    method: str,
    path: str,
    token: Optional[str] = None,
    body: Any = None,
    data: Optional[bytes] = None,
    content_type: Optional[str] = None,
) -> Any:
    """An internal (session) route of the backend, outside the client."""
    headers: Dict[str, str] = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        data = json.dumps(body).encode()
        content_type = "application/json"
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            text = res.read().decode()
    except urllib.error.HTTPError as e:
        raise AssertionError(f"{method} {path} failed ({e.code}): {e.read().decode()}") from None
    try:
        return json.loads(text) if text else None
    except ValueError:
        return text


def multipart(fields: Dict[str, str], file_name: str, content: str) -> tuple:
    boundary = "invokedb" + uuid.uuid4().hex
    parts = []
    for name, value in fields.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'
        )
    parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; "
        f'name="file"; filename="{file_name}"\r\nContent-Type: text/csv\r\n\r\n{content}\r\n'
    )
    parts.append(f"--{boundary}--\r\n")
    return "".join(parts).encode(), f"multipart/form-data; boundary={boundary}"


@unittest.skipUnless(BASE, "set INVOKEDB_TEST_BASE to run against a backend")
class LiveTest(unittest.TestCase):
    token: str
    account_id: int
    file_id: Any
    key_id: Any
    table_name: str
    db: InvokeDBClient
    table: InvokeDBTable

    @classmethod
    def wait_until_ready(cls) -> None:
        for _ in range(120):
            dirs = call("GET", f"/file-directory?account_id={cls.account_id}", cls.token)
            file = next((d for d in dirs if d["id"] == cls.file_id), None)
            if file is None:
                raise AssertionError(f"table {cls.file_id} disappeared")
            if file.get("status") == "ERROR":
                raise AssertionError(f"processing failed: {file.get('status_reason')}")
            if not file.get("status"):
                return
            time.sleep(0.5)
        raise AssertionError(f"table {cls.file_id} still processing after 60s")

    @classmethod
    def setUpClass(cls) -> None:
        cls.file_id = None
        cls.key_id = None
        session = call("POST", "/auth/login", body={"email": EMAIL, "password": PASSWORD})
        cls.token = session["token"]
        cls.account_id = call("GET", f"/auth/authorize?token={cls.token}")["id"]
        try:
            made = call(
                "POST",
                "/api-key",
                cls.token,
                body={"name": "Python client tests", "access": "read_write"},
            )
            cls.key_id = made["key"]["id"]

            cls.table_name = "py_client_" + uuid.uuid4().hex[:8]
            data, content_type = multipart(
                {"new_name": cls.table_name, "account_id": str(cls.account_id)},
                "people.csv",
                CSV,
            )
            cls.file_id = call(
                "POST", "/web-file/file_upload", cls.token, data=data, content_type=content_type
            )
            cls.wait_until_ready()

            # age is a number column, so range filters and numeric sort work
            cols = call(
                "POST",
                f"/web-file/data_grid_column/{cls.file_id}?skip=0&limit=100",
                cls.token,
                body={},
            )["data"]
            changed = [
                {**c, "col_type": "number", "indexed": True}
                for c in cols
                if c["headerName"] == "age"
            ]
            call(
                "PUT",
                f"/web-file/batch_update_job/data_grid_column/{cls.file_id}",
                cls.token,
                body=changed,
            )
            cls.wait_until_ready()

            cls.db = InvokeDBClient(made["secret"], BASE + "/api/v1")
            cls.table = cls.db.table(cls.table_name)
            # The column job may not have started when the table first looks ready
            for _ in range(120):
                ages = [r.get("age") for r in cls.table.get()["data"]]
                if ages and all(isinstance(a, (int, float)) for a in ages):
                    break
                time.sleep(0.5)
            else:
                raise AssertionError("age never became a number column")
        except BaseException:
            cls.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls) -> None:
        if cls.file_id is not None:
            call("POST", "/file-directory/batch_delete", cls.token, body={"ids": [cls.file_id]})
            cls.file_id = None
        if cls.key_id is not None:
            call("DELETE", f"/api-key/{cls.key_id}", cls.token)
            cls.key_id = None

    def test_1_read(self) -> None:
        res = self.table.get(limit=10, sort_by="age", sort_dir="desc")
        self.assertEqual(res["count"], 3)
        self.assertEqual([r["name"] for r in res["data"]], ["bob", "alice", "carol"])
        self.assertTrue(all("_id" in r for r in res["data"]))
        second = self.table.get(skip=1, limit=1, sort_by="age")["data"]
        self.assertEqual([r["name"] for r in second], ["alice"])
        self.assertEqual(self.table.count(), 3)

        # Table names match case-insensitively
        self.assertEqual(self.db.table(self.table_name.upper()).count(), 3)

        paris = self.table.search({"city": {"$eq": "Paris"}}, sort_by="name")
        self.assertEqual([r["name"] for r in paris["data"]], ["alice", "carol"])
        self.assertEqual(paris["count"], 2)
        older = self.table.search({"age": [{"$gte": 26}, {"$lte": 40}]})
        self.assertEqual([r["name"] for r in older["data"]], ["alice"])
        row = self.table.find_one({"name": {"$ctn": "AR"}})
        self.assertIsNotNone(row)
        self.assertEqual(row and row["name"], "carol")
        self.assertIsNone(self.table.find_one({"name": "nobody"}))

    def test_2_query_and_count(self) -> None:
        res = self.table.query(
            filters=[{"column": "city", "op": "eq", "value": "Paris"}],
            sort=["-age"],
            fields=["name", "age"],
            limit=10,
        )
        self.assertEqual(
            [(r["name"], r["age"]) for r in res["data"]], [("alice", 30), ("carol", 25)]
        )
        self.assertNotIn("city", res["data"][0])
        self.assertIsNone(res["next_cursor"])

        page = self.table.query({"sort": ["name"], "limit": 2})
        self.assertEqual(len(page["data"]), 2)
        self.assertIsNotNone(page["next_cursor"])
        names = [r["name"] for r in self.table.query_all(sort=["name"], limit=1)]
        self.assertEqual(names, ["alice", "bob", "carol"])

        self.assertEqual(self.table.count(filters=[{"column": "age", "op": "gt", "value": 26}]), 2)
        either = [
            {"column": "city", "op": "eq", "value": "Rome"},
            {"column": "age", "op": "lt", "value": 26},
        ]
        self.assertEqual(self.table.count({"filters": either, "match": "any"}), 2)

    def test_3_write(self) -> None:
        self.table.insert({"name": "dave", "age": 52, "city": "Oslo"})
        self.table.insert([{"name": "erin", "age": 19, "city": "Oslo"}, {"name": "finn"}])
        self.assertEqual(self.table.count(), 6)

        dave = self.table.find_one({"name": "dave"})
        assert dave is not None
        self.table.update({"_id": dave["_id"], "city": "Bergen"})
        dave2 = self.table.find_one({"name": "dave"})
        assert dave2 is not None
        self.assertEqual((dave2["city"], dave2["age"]), ("Bergen", 52))

        oslo = self.table.search({"city": "Oslo"})["data"]
        finn = self.table.find_one({"name": "finn"})
        assert finn is not None
        self.table.delete(dave["_id"])
        self.table.delete([r["_id"] for r in oslo] + [finn["_id"]])
        self.assertEqual(self.table.count(), 3)

    def test_4_errors(self) -> None:
        with self.assertRaises(InvokeDBError) as ctx:
            self.db.table("no_such_table_" + uuid.uuid4().hex[:8]).get()
        self.assertEqual(ctx.exception.status, 400)
        with self.assertRaises(InvokeDBError) as ctx:
            self.table.query(filters=[{"column": "no_such_column", "op": "eq", "value": 1}])
        self.assertEqual(ctx.exception.status, 400)
        with self.assertRaises(InvokeDBError) as ctx:
            InvokeDBClient("not-a-key", BASE + "/api/v1").table(self.table_name).get()
        self.assertEqual(ctx.exception.status, 401)

    def test_5_api_docs_requests(self) -> None:
        """Each request in the table's API docs (the curl, fetch and Python snippets) made with
        the client instead: the same endpoint, query parameters and body."""
        docs = call("GET", f"/web-file/{self.file_id}/api-docs", self.token)
        endpoints = {e["id"]: e for e in docs["endpoints"]}
        self.assertEqual(
            set(endpoints), {"get", "search", "query", "count", "create", "update", "delete"}
        )

        def page(e: Dict[str, Any]) -> Dict[str, Any]:
            q = {k: v[0] for k, v in parse_qs(urlsplit(e["url"]).query).items()}
            return {"skip": int(q["skip"]), "limit": int(q["limit"])}

        def body(e: Dict[str, Any], row_id: str = "") -> Any:
            text = json.dumps(e["body"]).replace(docs["row_id_placeholder"], row_id)
            return json.loads(text)

        got = self.table.get(**page(endpoints["get"]))
        self.assertEqual(got["count"], 3)
        found = self.table.search(body(endpoints["search"]), **page(endpoints["search"]))
        self.assertIsInstance(found["count"], int)
        queried = self.table.query(body(endpoints["query"]))
        self.assertIsInstance(queried["data"], list)
        self.assertIsInstance(self.table.count(body(endpoints["count"])), int)

        def ids() -> set:
            return {r["_id"] for r in self.table.get(limit=100)["data"]}

        before = ids()
        self.table.insert(body(endpoints["create"]))
        added = ids() - before
        self.assertEqual(len(added), 1)
        new_id = added.pop()
        self.table.update(body(endpoints["update"], new_id))
        self.table.delete(body(endpoints["delete"], new_id))
        self.assertEqual(ids(), before)


if __name__ == "__main__":
    unittest.main()
