"""Local SQLite mirror of Apollo tables — for analyses and development without the server.

Each pulled table becomes a SQLite table with the original column names plus `_recno`
(CONZEPT record number; unique per table, verified on kpf_std with 1,258,725 rows). A pull
is a full refresh written into a temporary table and swapped in atomically, so a mirror is
never half-updated. `_apollo_meta` records the wire type per column; `rows()` restores the
driver's Python types, so `Feeds(Mirror(...))` produces the same files as a live run.

Storage: date -> ISO text, time -> 'HH:MM:SS.hh', bool -> 0/1, str unchanged (trailing
blanks kept), numbers native.
"""
from __future__ import annotations

import datetime as dt
import sqlite3
import time
from collections.abc import Iterable

from . import protocol as p
from .client import Apollo


def _qi(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


_SQLTYPE = {p.T_STR: "TEXT", p.T_DATE: "TEXT", p.T_TIME: "TEXT", p.T_DBL: "REAL",
            p.T_I16: "INTEGER", p.T_I32: "INTEGER", p.T_I64: "INTEGER", p.T_BOOL: "INTEGER",
            p.T_NUM: "TEXT"}


def _to_db(v, ty: int):
    if v is None:
        return None
    if ty == p.T_DATE:
        return v.isoformat()
    if ty == p.T_BOOL:
        return 1 if v else 0
    return v


def _from_db(v, ty: int):
    if ty == p.T_DATE:
        return None if v is None else dt.date.fromisoformat(v)
    if ty == p.T_BOOL:
        return bool(v)
    if ty == p.T_DBL and v is not None:
        return float(v)
    return v


class Mirror:
    def __init__(self, path: str):
        self.path = path
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE IF NOT EXISTS _apollo_meta (tbl TEXT, col TEXT, wire_type INTEGER, "
                        "ord INTEGER, PRIMARY KEY (tbl, col))")
        self.db.execute("CREATE TABLE IF NOT EXISTS _apollo_pulls (tbl TEXT PRIMARY KEY, database TEXT, "
                        "rows INTEGER, columns INTEGER, seconds REAL, pulled_at TEXT)")
        self.db.commit()

    def close(self) -> None:
        self.db.close()

    # ------------------------------------------------------------------ pulling
    def pull(self, apollo: Apollo, table: str, columns: list[str] | None = None) -> int:
        t = apollo.schema[table]
        cols = t.select(columns)
        t0 = time.perf_counter()
        rows = apollo.fetch(table, [c.name for c in cols], with_recno=True)
        tmp = f"_tmp_{table}"
        cur = self.db.cursor()
        cur.execute(f"DROP TABLE IF EXISTS {_qi(tmp)}")
        coldefs = ", ".join(f"{_qi(c.name)} {_SQLTYPE.get(c.type, 'TEXT')}" for c in cols)
        cur.execute(f"CREATE TABLE {_qi(tmp)} (_recno INTEGER PRIMARY KEY, {coldefs})")
        ph = ",".join("?" * (len(cols) + 1))
        types = [c.type for c in cols]
        cur.executemany(f"INSERT INTO {_qi(tmp)} VALUES ({ph})",
                        ((r[0], *(_to_db(v, ty) for v, ty in zip(r[1:], types))) for r in rows))
        self.db.commit()
        # swap in one transaction: readers see either the old or the new table
        cur.execute("BEGIN")
        cur.execute(f"DROP TABLE IF EXISTS {_qi(table)}")
        cur.execute(f"ALTER TABLE {_qi(tmp)} RENAME TO {_qi(table)}")
        cur.execute("DELETE FROM _apollo_meta WHERE tbl = ?", (table,))
        cur.executemany("INSERT INTO _apollo_meta VALUES (?,?,?,?)",
                        [(table, c.name, c.type, i) for i, c in enumerate(cols)])
        cur.execute("INSERT OR REPLACE INTO _apollo_pulls VALUES (?,?,?,?,?,?)",
                    (table, apollo.database, len(rows), len(cols), round(time.perf_counter() - t0, 3),
                     dt.datetime.now().isoformat(timespec="seconds")))
        self.db.commit()
        return len(rows)

    # ------------------------------------------------------------------ reading (Feeds source)
    def _types(self, table: str) -> dict[str, int]:
        return dict(self.db.execute("SELECT col, wire_type FROM _apollo_meta WHERE tbl = ?", (table,)))

    def rows(self, table: str, columns: list[str]) -> list[tuple]:
        types = self._types(table)
        missing = [c for c in columns if c not in types]
        if missing:
            raise KeyError(f"mirror table {table} lacks columns {missing} — pull them first")
        sql = f"SELECT {', '.join(_qi(c) for c in columns)} FROM {_qi(table)} ORDER BY _recno"
        tys = [types[c] for c in columns]
        return [tuple(_from_db(v, ty) for v, ty in zip(r, tys)) for r in self.db.execute(sql)]

    def tables(self) -> list[tuple]:
        return list(self.db.execute("SELECT tbl, database, rows, columns, seconds, pulled_at "
                                    "FROM _apollo_pulls ORDER BY tbl"))


def pull_many(apollo: Apollo, mirror: Mirror, plan: Iterable[tuple[str, list[str] | None]],
              on_table=None) -> dict[str, object]:
    """Pull several tables in one session. Stops at the first server abort (the guard is
    tripped by the client; continuing would only fail)."""
    result: dict[str, object] = {}
    for table, cols in plan:
        t0 = time.perf_counter()
        try:
            n = mirror.pull(apollo, table, cols)
            result[table] = n
        except p.ServerAbort as exc:
            result[table] = f"aborted: {exc}"
            if on_table:
                on_table(table, None, time.perf_counter() - t0, str(exc))
            break
        if on_table:
            on_table(table, n, time.perf_counter() - t0, None)
    return result
