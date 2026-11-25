"""InvokeDB Python client. Standard library only (urllib), so it has no dependencies.

Mirrors the JavaScript client in ``examples/invokedb-node``: get, search, query, count,
insert, update and delete on a table, by name, with an API key.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterator, List, Literal, Optional, Sequence, TypedDict, Union

__all__ = [
    "DEFAULT_BASE_URL",
    "CountQuery",
    "FindResult",
    "InvokeDBClient",
    "InvokeDBError",
    "InvokeDBTable",
    "Query",
    "QueryFilter",
    "QueryResult",
    "Row",
    "SortColumn",
]

# There is no public API for now, so the default is the local dev backend.
DEFAULT_BASE_URL = "http://127.0.0.1:8001/api/v1"
DEFAULT_LIMIT = 10
DEFAULT_TIMEOUT = 30.0

Row = Dict[str, Any]
QueryOp = Literal["eq", "ne", "gt", "gte", "lt", "lte", "contains", "in", "empty"]
SortDir = Literal["asc", "desc"]


class _QueryFilterRequired(TypedDict):
    column: str
    op: QueryOp
    value: Any


class QueryFilter(_QueryFilterRequired, total=False):
    """``{"column": "points", "op": "gte", "value": 90}``"""

    case: Literal["sensitive", "insensitive"]


class _SortColumnRequired(TypedDict):
    column: str


class SortColumn(_SortColumnRequired, total=False):
    dir: SortDir


class CountQuery(TypedDict, total=False):
    filters: List[QueryFilter]
    match: Literal["all", "any"]


class Query(CountQuery, total=False):
    sort: List[Union[str, SortColumn]]
    fields: List[str]
    limit: int
    cursor: Optional[str]
    explain: bool


class FindResult(TypedDict):
    count: int
    data: List[Row]


class QueryResult(TypedDict):
    data: List[Row]
    next_cursor: Optional[str]


class InvokeDBError(Exception):
    """A failed request. ``status`` is the HTTP status (0 if the server couldn't be reached)
    and ``body`` the response body (parsed JSON when it is JSON)."""

    def __init__(self, message: str, status: int, body: Any = None) -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.body = body


def _parse(text: str) -> Any:
    if not text:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return text  # not JSON: keep the text


def _expand_param(expand: Union[str, Sequence[str], None]) -> Optional[str]:
    if expand is None:
        return None
    if isinstance(expand, str):
        return expand
    return ",".join(expand)


class _Transport:
    def __init__(self, base_url: str, api_key: str, timeout: float) -> None:
        self.base_url = base_url
        self.api_key = api_key
        self.timeout = timeout

    def request(
        self,
        method: str,
        action: str,
        table: str,
        params: Optional[Dict[str, Any]] = None,
        body: Any = None,
        has_body: bool = False,
    ) -> Any:
        query: Dict[str, Any] = {"table": table}
        for name, value in (params or {}).items():
            if value is not None:
                query[name] = value
        url = f"{self.base_url}/{action}?{urllib.parse.urlencode(query)}"
        headers = {"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"}
        data = None
        if has_body:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                return _parse(res.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            parsed = _parse(e.read().decode("utf-8", "replace"))
            message = (
                parsed.get("message") if isinstance(parsed, dict) else None
            ) or f"InvokeDB request failed with status {e.code}"
            if not isinstance(message, str):
                message = json.dumps(message)
            raise InvokeDBError(message, e.code, parsed) from None
        except urllib.error.URLError as e:
            raise InvokeDBError(
                f"Can't reach {self.base_url} ({e.reason}). Is the backend running?", 0
            ) from e
        except OSError as e:  # a timeout or a dropped connection while reading the answer
            raise InvokeDBError(f"InvokeDB request failed: {e}", 0) from e


def _rows(data: Union[Row, Sequence[Row]], action: str) -> List[Row]:
    if isinstance(data, dict):
        return [data]
    if isinstance(data, (list, tuple)) and all(isinstance(r, dict) for r in data):
        return list(data)
    raise TypeError(f"{action} takes a row (dict) or a list of rows")


def _find_result(res: Any) -> FindResult:
    if isinstance(res, dict) and isinstance(res.get("data"), list):
        return {"count": res.get("count", len(res["data"])), "data": res["data"]}
    return {"count": 0, "data": []}


class InvokeDBTable:
    """One table, by name (names match case-insensitively)."""

    def __init__(self, transport: _Transport, name: str) -> None:
        self._t = transport
        self.name = name

    def _page(
        self,
        skip: int,
        limit: int,
        sort_by: Optional[str],
        sort_dir: SortDir,
        expand: Union[str, Sequence[str], None],
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {"skip": skip, "limit": limit}
        if sort_by:
            params["sort_by"] = sort_by
            params["sort_dir"] = sort_dir
        params["expand"] = _expand_param(expand)
        return params

    def get(
        self,
        *,
        skip: int = 0,
        limit: int = DEFAULT_LIMIT,
        sort_by: Optional[str] = None,
        sort_dir: SortDir = "asc",
        expand: Union[str, Sequence[str], None] = None,
    ) -> FindResult:
        """A page of rows and the total row count (``GET /get``)."""
        params = self._page(skip, limit, sort_by, sort_dir, expand)
        return _find_result(self._t.request("GET", "get", self.name, params))

    def search(
        self,
        filter: Dict[str, Any],
        *,
        skip: int = 0,
        limit: int = DEFAULT_LIMIT,
        sort_by: Optional[str] = None,
        sort_dir: SortDir = "asc",
        expand: Union[str, Sequence[str], None] = None,
    ) -> FindResult:
        """Rows matching a filter (``POST /search``), such as
        ``{"country": {"$eq": "France"}, "points": {"$gte": 90}}``, and how many match."""
        if not isinstance(filter, dict):
            raise TypeError("search takes a filter (dict)")
        params = self._page(skip, limit, sort_by, sort_dir, expand)
        res = self._t.request("POST", "search", self.name, params, filter, has_body=True)
        return _find_result(res)

    def find_one(self, filter: Optional[Dict[str, Any]] = None) -> Optional[Row]:
        """The first row matching a filter (or the first row), or ``None``."""
        res = self.get(limit=1) if filter is None else self.search(filter, limit=1)
        return res["data"][0] if res["data"] else None

    def query(
        self,
        query: Optional[Query] = None,
        *,
        expand: Union[str, Sequence[str], None] = None,
        **options: Any,
    ) -> QueryResult:
        """Filters, sort, fields and cursor paging (``POST /query``). Pass the query as a dict
        or as keywords: ``query(filters=[...], sort=["-points"], fields=[...], limit=50)``.
        Pass ``next_cursor`` back as ``cursor`` (with the same filters and sort) for the
        next page; it's ``None`` on the last one."""
        body: Dict[str, Any] = dict(query or {})
        body.update(options)
        params = {"expand": _expand_param(expand)}
        return self._t.request("POST", "query", self.name, params, body, has_body=True)

    def query_all(
        self,
        query: Optional[Query] = None,
        *,
        expand: Union[str, Sequence[str], None] = None,
        **options: Any,
    ) -> Iterator[Row]:
        """Every row the query matches, following ``next_cursor`` page by page."""
        body: Dict[str, Any] = dict(query or {})
        body.update(options)
        while True:
            res = self.query(body, expand=expand)  # type: ignore[arg-type]
            yield from res["data"]
            if not res.get("next_cursor"):
                return
            body["cursor"] = res["next_cursor"]

    def count(self, query: Optional[CountQuery] = None, **options: Any) -> int:
        """With no arguments, the total row count; with ``filters`` (and ``match``), the
        number of rows that match (``POST /count``)."""
        if query is None and not options:
            return self.get(limit=1)["count"]
        body: Dict[str, Any] = dict(query or {})
        body.update(options)
        res = self._t.request("POST", "count", self.name, None, body, has_body=True)
        return int(res["count"])

    def insert(self, rows: Union[Row, Sequence[Row]]) -> Any:
        """Add a row or a list of rows (``POST /create``)."""
        body = _rows(rows, "insert")
        return self._t.request("POST", "create", self.name, None, body, has_body=True)

    def update(self, rows: Union[Row, Sequence[Row]]) -> Any:
        """Change rows by ``_id`` (``PUT /update``); only the columns you pass change."""
        body = _rows(rows, "update")
        return self._t.request("PUT", "update", self.name, None, body, has_body=True)

    def delete(self, ids: Union[str, Sequence[str]]) -> Any:
        """Delete a row or rows by ``_id`` (``POST /delete``)."""
        body = [ids] if isinstance(ids, str) else list(ids)
        if not all(isinstance(i, str) for i in body):
            raise TypeError("delete takes an _id or a list of _ids")
        return self._t.request("POST", "delete", self.name, None, body, has_body=True)


class InvokeDBClient:
    """``InvokeDBClient(api_key, base_url=...)``; then ``client.table("name")``."""

    def __init__(
        self,
        api_key: str,
        base_url: Optional[str] = None,
        *,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        if not api_key or not isinstance(api_key, str):
            raise TypeError("Must provide a valid api key")
        self._transport = _Transport(
            (base_url or DEFAULT_BASE_URL).rstrip("/"), api_key, timeout
        )

    @property
    def base_url(self) -> str:
        return self._transport.base_url

    def table(self, name: str) -> InvokeDBTable:
        if not name or not isinstance(name, str):
            raise TypeError("Must provide a table name")
        return InvokeDBTable(self._transport, name)
