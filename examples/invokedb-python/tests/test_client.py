"""Unit tests: the client against a local stub server, so they need no backend.

    python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Tuple
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from invokedb import InvokeDBClient, InvokeDBError  # noqa: E402


class Stub:
    """Records each request and answers with the next queued (status, body)."""

    def __init__(self) -> None:
        self.requests: List[Dict[str, Any]] = []
        self.replies: List[Tuple[int, Any]] = []
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def _handle(self) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length).decode() if length else None
                url = urlsplit(self.path)
                stub.requests.append(
                    {
                        "method": self.command,
                        "path": url.path,
                        "query": {k: v[0] for k, v in parse_qs(url.query).items()},
                        # urllib sends "Content-type": compare header names in lower case
                        "headers": {k.lower(): v for k, v in self.headers.items()},
                        "body": json.loads(raw) if raw else None,
                    }
                )
                status, body = stub.replies.pop(0) if stub.replies else (200, None)
                out = b"" if body is None else (
                    body.encode() if isinstance(body, str) else json.dumps(body).encode()
                )
                self.send_response(status)
                self.send_header("Content-Length", str(len(out)))
                self.end_headers()
                self.wfile.write(out)

            do_GET = do_POST = do_PUT = _handle

            def log_message(self, *args: Any) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}/api/v1"

    def reply(self, status: int, body: Any) -> None:
        self.replies.append((status, body))

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


class ClientTest(unittest.TestCase):
    def setUp(self) -> None:
        self.stub = Stub()
        self.db = InvokeDBClient("key123", self.stub.base_url + "//")
        self.table = self.db.table("wine reviews")

    def tearDown(self) -> None:
        self.stub.close()

    def last(self) -> Dict[str, Any]:
        return self.stub.requests[-1]

    def test_needs_a_key_and_a_table_name(self) -> None:
        with self.assertRaises(TypeError):
            InvokeDBClient("")
        with self.assertRaises(TypeError):
            self.db.table("")

    def test_default_base_url_and_trailing_slashes(self) -> None:
        self.assertEqual(InvokeDBClient("k").base_url, "http://127.0.0.1:8001/api/v1")
        self.assertEqual(self.db.base_url, self.stub.base_url)

    def test_get(self) -> None:
        self.stub.reply(200, {"count": 3, "data": [{"_id": "a", "name": "x"}]})
        res = self.table.get(skip=20, limit=5, sort_by="points", sort_dir="desc")
        self.assertEqual(res, {"count": 3, "data": [{"_id": "a", "name": "x"}]})
        r = self.last()
        self.assertEqual(r["method"], "GET")
        self.assertEqual(r["path"], "/api/v1/get")
        self.assertEqual(
            r["query"],
            {
                "table": "wine reviews",
                "skip": "20",
                "limit": "5",
                "sort_by": "points",
                "sort_dir": "desc",
            },
        )
        self.assertEqual(r["headers"]["authorization"], "Bearer key123")
        self.assertIsNone(r["body"])

    def test_get_defaults_and_expand(self) -> None:
        self.table.get(expand=["owner", "tags"])
        self.assertEqual(
            self.last()["query"],
            {"table": "wine reviews", "skip": "0", "limit": "10", "expand": "owner,tags"},
        )

    def test_get_with_no_data_is_empty(self) -> None:
        self.stub.reply(200, None)
        self.assertEqual(self.table.get(), {"count": 0, "data": []})

    def test_search(self) -> None:
        flt = {"country": {"$eq": "France"}, "price": [{"$gte": 20}, {"$lte": 60}]}
        self.stub.reply(201, {"count": 1, "data": [{"_id": "a"}]})
        res = self.table.search(flt, limit=3, sort_by="points")
        self.assertEqual(res["count"], 1)
        r = self.last()
        self.assertEqual((r["method"], r["path"]), ("POST", "/api/v1/search"))
        self.assertEqual(r["query"]["limit"], "3")
        self.assertEqual(r["query"]["sort_dir"], "asc")
        self.assertEqual(r["body"], flt)
        self.assertEqual(r["headers"]["content-type"], "application/json")
        with self.assertRaises(TypeError):
            self.table.search([])  # type: ignore[arg-type]

    def test_find_one(self) -> None:
        self.stub.reply(201, {"count": 2, "data": [{"_id": "a"}]})
        self.assertEqual(self.table.find_one({"name": "x"}), {"_id": "a"})
        self.assertEqual(self.last()["query"]["limit"], "1")
        self.stub.reply(200, {"count": 0, "data": []})
        self.assertIsNone(self.table.find_one())
        self.assertEqual(self.last()["method"], "GET")

    def test_query_dict_and_keywords(self) -> None:
        q = {"filters": [{"column": "points", "op": "gte", "value": 90}], "limit": 2}
        self.stub.reply(200, {"data": [{"_id": "a"}], "next_cursor": "c1"})
        res = self.table.query(q, sort=["-points"], expand="owner")  # type: ignore[arg-type]
        self.assertEqual(res["next_cursor"], "c1")
        r = self.last()
        self.assertEqual((r["method"], r["path"]), ("POST", "/api/v1/query"))
        self.assertEqual(r["query"], {"table": "wine reviews", "expand": "owner"})
        self.assertEqual(r["body"], {**q, "sort": ["-points"]})
        self.assertNotIn("cursor", q)  # the caller's dict is left alone
        self.table.query()
        self.assertEqual(self.last()["body"], {})

    def test_query_all_follows_the_cursor(self) -> None:
        self.stub.reply(200, {"data": [{"_id": "a"}, {"_id": "b"}], "next_cursor": "c1"})
        self.stub.reply(200, {"data": [{"_id": "c"}], "next_cursor": None})
        rows = list(self.table.query_all(limit=2, sort=["name"]))
        self.assertEqual([r["_id"] for r in rows], ["a", "b", "c"])
        self.assertNotIn("cursor", self.stub.requests[0]["body"])
        self.assertEqual(
            self.stub.requests[1]["body"], {"limit": 2, "sort": ["name"], "cursor": "c1"}
        )

    def test_count(self) -> None:
        self.stub.reply(200, {"count": 42, "data": [{"_id": "a"}]})
        self.assertEqual(self.table.count(), 42)
        self.assertEqual(self.last()["path"], "/api/v1/get")
        filters = [{"column": "country", "op": "eq", "value": "France"}]
        self.stub.reply(200, {"count": 7})
        self.assertEqual(self.table.count(filters=filters, match="any"), 7)
        r = self.last()
        self.assertEqual((r["method"], r["path"]), ("POST", "/api/v1/count"))
        self.assertEqual(r["body"], {"filters": filters, "match": "any"})

    def test_insert_update_delete(self) -> None:
        self.stub.reply(201, "")
        self.assertIsNone(self.table.insert({"name": "x"}))
        self.assertEqual(self.last()["path"], "/api/v1/create")
        self.assertEqual(self.last()["body"], [{"name": "x"}])
        self.table.insert([{"name": "a"}, {"name": "b"}])
        self.assertEqual(len(self.last()["body"]), 2)

        self.stub.reply(200, 1)
        self.assertEqual(self.table.update({"_id": "a", "name": "y"}), 1)
        r = self.last()
        self.assertEqual((r["method"], r["path"]), ("PUT", "/api/v1/update"))
        self.assertEqual(r["body"], [{"_id": "a", "name": "y"}])

        self.stub.reply(201, 1)
        self.assertEqual(self.table.delete("a"), 1)
        r = self.last()
        self.assertEqual((r["method"], r["path"], r["body"]), ("POST", "/api/v1/delete", ["a"]))
        self.table.delete(["a", "b"])
        self.assertEqual(self.last()["body"], ["a", "b"])

        with self.assertRaises(TypeError):
            self.table.insert("nope")  # type: ignore[arg-type]
        with self.assertRaises(TypeError):
            self.table.update([1])  # type: ignore[list-item]
        with self.assertRaises(TypeError):
            self.table.delete([1])  # type: ignore[list-item]

    def test_errors(self) -> None:
        self.stub.reply(400, {"statusCode": 400, "message": "File name not found"})
        with self.assertRaises(InvokeDBError) as ctx:
            self.table.get()
        self.assertEqual(str(ctx.exception), "File name not found")
        self.assertEqual(ctx.exception.status, 400)
        self.assertEqual(ctx.exception.body["statusCode"], 400)

        self.stub.reply(502, "Bad gateway")
        with self.assertRaises(InvokeDBError) as ctx:
            self.table.get()
        self.assertEqual(ctx.exception.status, 502)
        self.assertEqual(ctx.exception.body, "Bad gateway")
        self.assertIn("502", str(ctx.exception))

    def test_unreachable(self) -> None:
        port = self.stub.server.server_port
        self.stub.close()
        db = InvokeDBClient("k", f"http://127.0.0.1:{port}/api/v1", timeout=2)
        with self.assertRaises(InvokeDBError) as ctx:
            db.table("t").get()
        self.assertEqual(ctx.exception.status, 0)
        self.stub = Stub()  # for tearDown


if __name__ == "__main__":
    unittest.main()
