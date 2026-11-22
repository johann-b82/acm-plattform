"""High-level read client: projection-first fetches with the session guard.

Efficiency (measured on the production server, 2026-11-22):
  * The server is the bottleneck (~20–37k rows/s, varies with ERP load); decoding is small.
  * Requesting only the needed columns is the biggest lever (kpf_std 2.3x, stm_std up to 25x).
  * A server filter pays off when it removes most rows: the feeds' date floors run on the server
    (pos_std 238 s -> 21 s, meld_std 48 -> 7 s, bestand_std 48 -> 6 s, identical rows). When it
    keeps almost everything it is slower than a local filter (kpf_datum: 115 s vs. 37 s).
    A filtered query returns rows in another order; CachedSource restores record order.
  * A second session brings no throughput (the server works serially) — one session.
"""
from __future__ import annotations

import os
import subprocess
import sys
from collections.abc import Callable, Iterable

from . import incidents, policy, protocol, schema as schema_mod
from .guard import Guard, Quarantine
from .policy import TableExcluded  # noqa: F401  (re-exported for callers)

# Tables the server aborts when all columns are requested at once; they are read in
# column groups and merged by record number (Statistiken: verified 4 x ~150 columns).
# Further tables are added automatically by the quarantine after an abort.
SPLIT_TABLES: dict[str, int] = {"Statistiken": 150}


class TableQuarantined(RuntimeError):
    """The table aborted the server session even in small column groups; it is skipped
    until a human resets the quarantine."""


def password_from_env() -> str:
    """APOLLO_PWD, or on Windows the user's DPAPI file apollo-cred.xml (Import-Clixml)."""
    pw = os.environ.get("APOLLO_PWD")
    if pw:
        return pw
    cred = os.environ.get("APOLLO_CRED_FILE") or os.path.join(os.path.expanduser("~"), "apollo-cred.xml")
    if sys.platform == "win32" and os.path.exists(cred):
        ps = ("$c=Import-Clixml '" + cred.replace("'", "''") + "';"
              "Write-Output ('__P__'+$c.GetNetworkCredential().Password)")
        r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
                           capture_output=True, text=True, timeout=30)
        for ln in r.stdout.splitlines():
            if ln.startswith("__P__"):
                return ln[5:].strip()
    raise RuntimeError("no Apollo password: set APOLLO_PWD (or apollo-cred.xml on Windows)")


class Apollo:
    """One guarded session for a run. Use as context manager; logs out on exit.

        with Apollo.from_env() as a:
            rows = a.fetch("kpf_std", ["kpf_id", "kpf_nr", "kpf_datum"])
    """

    def __init__(self, host: str, port: int = 4722, database: str = "apollo",
                 password: str | None = None, schema: schema_mod.Schema | None = None,
                 guard: Guard | None = None, timeout: float = 300):
        self.schema = schema or schema_mod.load()
        self.guard = guard or Guard()
        self.quarantine = Quarantine(self.guard.path.parent / "quarantine.json")
        self._password = password
        self._session = protocol.Session(host, port, database, timeout)
        self.database = database

    @classmethod
    def from_env(cls, **kw) -> "Apollo":
        return cls(host=os.environ.get("APOLLO_HOST", "192.9.200.134"),
                   port=int(os.environ.get("APOLLO_PORT", "4722")),
                   database=os.environ.get("APOLLO_DB", "apollo"), **kw)

    def __enter__(self) -> "Apollo":
        self.connect()
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def connect(self) -> None:
        self.guard.check()
        pw = self._password if self._password is not None else password_from_env()
        try:
            self._session.connect(pw)
        except protocol.SessionRefused as exc:
            self.guard.trip(f"session refused ({exc.code})")
            incidents.write("refused", error=exc, code=exc.code)
            raise
        finally:
            del pw

    def close(self) -> None:
        self._session.close()

    # ------------------------------------------------------------------ reading
    def _run(self, table: schema_mod.Table, cols: tuple[schema_mod.Column, ...],
             server_filter, limit: int | None = None) -> list[tuple[int | None, list]]:
        return list(self._iter(table, cols, server_filter, limit))

    def _iter(self, table: schema_mod.Table, cols: tuple[schema_mod.Column, ...],
              server_filter, limit: int | None = None):
        try:
            if limit is None:      # keep the call shape simple for sessions without `limit`
                yield from self._session.query(table.file, [c.address for c in cols], server_filter)
            else:
                yield from self._session.query(table.file, [c.address for c in cols], server_filter,
                                               limit=limit)
        except protocol.ServerAbort as exc:
            entry = self.quarantine.record_abort(table.name, len(cols))
            nxt = "skip" if entry["skip"] else "groups of %s" % entry["group"]
            self.guard.trip(f"server aborted the session on {table.name} (next: {nxt})")
            incidents.write("server_abort", table.name, cols, exc, next=nxt, limit=limit)
            raise
        except protocol.DecodeFailure as exc:
            # the session is still healthy (drained + closed); leave a replayable incident
            exc.incident = incidents.write("decode", table.name, cols, exc.cause, exc.frames,
                                           row_index=exc.row_index, limit=limit)
            raise

    def stream(self, table: str, columns: list[str], limit: int | None = None):
        """Yield (record number, values) without materializing — for large reads/statistics.
        Same protections as fetch (policy, quarantine, incidents); no column-group merging,
        so request at most the quarantine group size of columns."""
        policy.check(table)
        t = self.schema[table]
        cols = t.select(columns)
        q = self.quarantine.get(table)
        if q and q.get("skip"):
            raise TableQuarantined(f"{table} is quarantined after {q.get('aborts')} server aborts")
        if q and q.get("group") and len(cols) > q["group"]:
            raise ValueError(f"{table}: request at most {q['group']} columns per stream (quarantine)")
        try:
            yield from self._session.query(t.file, [c.address for c in cols], None, limit=limit)
        except protocol.ServerAbort as exc:
            entry = self.quarantine.record_abort(table, len(cols))
            nxt = "skip" if entry["skip"] else "groups of %s" % entry["group"]
            self.guard.trip(f"server aborted the session on {table} (next: {nxt})")
            incidents.write("server_abort", table, cols, exc, next=nxt, limit=limit)
            raise
        except protocol.DecodeFailure as exc:
            exc.incident = incidents.write("decode", table, cols, exc.cause, exc.frames,
                                           row_index=exc.row_index, limit=limit)
            raise

    def count(self, table: str, cap: int | None = None) -> tuple[int, bool, bool]:
        """Count rows by streaming the first column only (nothing kept in memory).
        Returns (rows, record numbers strictly increasing, capped)."""
        policy.check(table)
        t = self.schema[table]
        q = self.quarantine.get(table)
        if q and q.get("skip"):
            raise TableQuarantined(f"{table} is quarantined after {q.get('aborts')} server aborts")
        col = t.columns[0]
        n, last, increasing = 0, None, True
        try:
            for rec, _ in self._session.query(t.file, [col.address], None, limit=cap):
                if last is not None and rec is not None and rec <= last:
                    increasing = False
                last = rec
                n += 1
        except protocol.ServerAbort as exc:
            entry = self.quarantine.record_abort(table, 1)
            self.guard.trip(f"server aborted the session on {table} (count)")
            incidents.write("server_abort", table, [col], exc, next="skip" if entry["skip"] else entry["group"])
            raise
        except protocol.DecodeFailure as exc:
            exc.incident = incidents.write("decode", table, [col], exc.cause, exc.frames, row_index=exc.row_index)
            raise
        return n, increasing, cap is not None and n >= cap

    def fetch(self, table: str, columns: list[str] | None = None,
              server_filter: tuple[str, str, object] | None = None,
              with_recno: bool = False, limit: int | None = None,
              keep: Callable[[tuple], bool] | None = None) -> list[tuple]:
        """All rows of `table` (only `columns`, default all) as tuples in column order;
        `limit` stops after that many rows (cleanly, like the driver closing a cursor early).
        `keep(values)` drops rows while streaming (local filter, keeps memory flat).

        server_filter = (column, '>' | '>=', value): evaluated on the server — worth it when it
        removes most rows (see module doc); rows may come back in another order. Values have the driver's Python types: double ->
        float, int16/int32/int64 -> int, date -> datetime.date or None, bool -> bool,
        str -> str (trailing blanks kept), time -> 'HH:MM:SS.hh'."""
        policy.check(table)                      # excluded tables never reach the server
        t = self.schema[table]
        cols = t.select(columns)
        flt = None
        if server_filter:
            c = t.column(server_filter[0])
            flt = (c.address, server_filter[1], server_filter[2])
        q = self.quarantine.get(table)
        if q and q.get("skip"):
            raise TableQuarantined(f"{table} is quarantined after {q.get('aborts')} server aborts")
        group = min(x for x in (SPLIT_TABLES.get(table), (q or {}).get("group")) if x) \
            if (SPLIT_TABLES.get(table) or (q or {}).get("group")) else None
        if group and len(cols) > group:
            parts = [cols[i:i + group] for i in range(0, len(cols), group)]
            results = [self._run(t, p, flt, limit) for p in parts]
            recnos = [r for r, _ in results[0]]
            for res in results[1:]:
                if [r for r, _ in res] != recnos:
                    raise protocol.ProtocolError(f"{table}: column groups returned different rows")
            rows = ((recnos[i], [v for res in results for v in res[i][1]]) for i in range(len(recnos)))
        else:
            rows = self._iter(t, cols, flt, limit)      # streamed: one copy of the kept rows only
        out = []
        for rec, vals in rows:
            vals = tuple(vals)
            if keep is None or keep(vals):
                out.append((rec, *vals) if with_recno else vals)
        return out


class CachedSource:
    """Run-scoped cache so that e.g. the article master is fetched once per run, with the
    union of all requested columns. Feeds read through this interface; a SQLite mirror
    implements the same `rows(table, columns)` for offline use."""

    def __init__(self, apollo: Apollo, row_floor: dict[str, tuple[str, object]] | None = None):
        """`row_floor` = {table: (column, bound)}: keep only rows with column >= bound (NULL
        dropped). Only valid when EVERY reader of the table filters at least that strictly —
        `Feeds.row_floor()` declares it, the equivalence tests prove it."""
        self.apollo = apollo
        self.row_floor = row_floor or {}
        self._cache: dict[str, tuple[list[str], list[tuple]]] = {}
        self._wanted: dict[str, set[str]] = {}
        self._failed: dict[str, Exception] = {}

    def prefetch(self, needs: dict[str, Iterable[str]]) -> None:
        """Declare all columns a run needs so every table is read exactly once."""
        for t, cols in needs.items():
            self._wanted.setdefault(t, set()).update(cols)

    def rows(self, table: str, columns: list[str]) -> "_Projection":
        if table in self._failed:               # failed once this run: don't ask the server again
            raise self._failed[table]
        have = self._cache.get(table)
        if have is None or not set(columns) <= set(have[0]):
            floor = self.row_floor.get(table)
            want = set(self._wanted.get(table, set())) | set(columns) | set(have[0] if have else [])
            if floor:
                want.add(floor[0])
            order = [c.name for c in self.apollo.schema[table].columns if c.name in want]
            keep = flt = None
            if floor:
                i, bound = order.index(floor[0]), floor[1]
                # floor on the server: the rows never cross the wire (Test 22.11.: pos_std 245 s ->
                # 56 s, meld_std 54 -> 21 s, bestand_std 48 -> 24 s, identical rows). `keep` stays
                # as a cheap safety net with the same condition.
                flt = (floor[0], ">=", bound)
                keep = (lambda r: r[i] is not None and r[i] >= bound)     # r = values, recno not yet added
            try:
                if flt:
                    # A filtered query returns the same rows in another order (index order, Test
                    # 22.11.). Restore record order so the files stay identical to the full scan.
                    rows = self.apollo.fetch(table, order, server_filter=flt, with_recno=True, keep=keep)
                    rows.sort(key=lambda r: r[0])
                    self._cache[table] = (["\0recno"] + order, rows)
                else:
                    self._cache[table] = (order, self.apollo.fetch(table, order))
            except (TableQuarantined, TableExcluded, protocol.DecodeFailure) as exc:
                self._failed[table] = exc
                raise
            have = self._cache[table]
        return _Projection(have[1], [have[0].index(c) for c in columns])


class _Projection:
    """Re-iterable column view of cached rows — no copy of the table per call."""
    __slots__ = ("_rows", "_idx")

    def __init__(self, rows: list[tuple], idx: list[int]):
        self._rows, self._idx = rows, idx

    def __iter__(self):
        idx = self._idx
        if idx == list(range(len(idx))) and all(len(r) == len(idx) for r in self._rows[:1]):
            return iter(self._rows)
        return (tuple(r[i] for i in idx) for r in self._rows)

    def __len__(self):
        return len(self._rows)
