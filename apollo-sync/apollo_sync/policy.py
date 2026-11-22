"""Table policy: which Apollo tables may be read at all — decided table by table by a human.

The bundled `table_policy.json` holds the defaults; a local decision file (env
APOLLO_SYNC_POLICY, e.g. /state/table_policy.json) overrides it entry by entry. A table with
"read": false never reaches the server: `Apollo.fetch` raises `TableExcluded` before any frame
is sent. Tables not listed are readable.
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from importlib import resources
from pathlib import Path


class TableExcluded(RuntimeError):
    """The table is excluded by the table policy; nothing was sent to the server."""


@lru_cache(maxsize=8)
def _load(path: str | None) -> dict:
    data = json.loads(resources.files(__package__).joinpath("table_policy.json").read_text(encoding="utf-8"))
    rules = dict(data.get("tables", {}))
    if path and Path(path).exists():
        local = json.loads(Path(path).read_text(encoding="utf-8"))
        rules.update(local.get("tables", {}))
    return rules


def rules(path: str | None = None) -> dict:
    return _load(path or os.environ.get("APOLLO_SYNC_POLICY"))


def allowed(table: str, path: str | None = None) -> bool:
    return rules(path).get(table, {}).get("read", True)


def check(table: str, path: str | None = None) -> None:
    r = rules(path).get(table)
    if r and not r.get("read", True):
        raise TableExcluded(f"{table} is excluded by the table policy: {r.get('reason', '')}")
