"""Readiness profile of every table: can it be read safely, does every column decode, how
big is it, which columns carry data, which are date/change columns.

Safe by construction (personal Apollo account, production ERP on the same server):
  * one session, tables strictly one after another;
  * every table in column groups of at most `group` columns (the only observed abort came
    from 595 columns in one projection; 150-column groups were fine);
  * large tables only up to `limit` rows per group (row count from a separate scan of the
    first column);
  * one JSON result per table -> resumable; after a server abort the table is quarantined, the
    profiler waits out the cool-down and continues with the next table.

The JSON files contain statistics and at most one example value per column — they describe
the customer's data and belong next to the analysis, not into a repository.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import time
from pathlib import Path

from . import incidents, policy
from . import protocol as p
from .client import Apollo, TableQuarantined
from .guard import CoolingDown

CHANGE_RE = re.compile(r"(datum_save|date_save|save_date|datum_edit|edit_date|datum_aend|aend_datum|"
                       r"zeit_save|time_save|save_time|datetime_save|_ldate|_ltime|user_save|user_edit)", re.I)


class _ColStats:
    """Streaming statistics of one column (constant memory)."""
    __slots__ = ("ty", "default", "filled", "mn", "mx", "max_len", "trailing", "h24", "frac", "example")

    def __init__(self, ty: int):
        self.ty, self.default = ty, p.DEFAULTS[ty]
        self.filled = self.max_len = self.trailing = self.h24 = self.frac = 0
        self.mn = self.mx = self.example = None

    def add(self, v) -> None:
        if v is None or v == self.default or v == "":
            return
        self.filled += 1
        if self.example is None:
            self.example = v
        if self.ty == p.T_STR:
            self.max_len = max(self.max_len, len(v))
            if v != v.rstrip(" "):
                self.trailing += 1
            return
        if self.ty == p.T_TIME and v.startswith("24:"):
            self.h24 += 1
        if self.ty == p.T_DBL and abs(v) < 1e15 and v != int(v):
            self.frac += 1
        if self.ty != p.T_BOOL:
            self.mn = v if self.mn is None or v < self.mn else self.mn
            self.mx = v if self.mx is None or v > self.mx else self.mx

    def result(self) -> dict:
        st: dict = {"type": self.ty, "filled": self.filled}
        if not self.filled:
            return st
        iso = (lambda x: x.isoformat() if isinstance(x, dt.date) else x)
        if self.ty == p.T_STR:
            st.update(max_len=self.max_len, trailing_blanks=self.trailing)
        elif self.ty == p.T_BOOL:
            st["true"] = self.filled
        else:
            st.update(min=iso(self.mn), max=iso(self.mx))
            if self.ty == p.T_TIME:
                st["hour_24"] = self.h24
            if self.ty == p.T_DBL:
                st["fractional"] = self.frac
        ex = self.example
        st["example"] = iso(ex)[:40] if isinstance(ex, str) else iso(ex)
        return st


def profile_table(a: Apollo, table: str, group: int = 100, limit: int | None = 200_000,
                  count_cap: int | None = 2_000_000) -> dict:
    t = a.schema[table]
    res: dict = {"table": table, "file": t.file, "columns": len(t.columns), "group": group,
                 "started": dt.datetime.now().isoformat(timespec="seconds")}
    t0 = time.perf_counter()
    rows, increasing, capped = a.count(table, cap=count_cap)
    res["rows"] = rows
    res["rows_at_least"] = capped            # counting stopped at the cap: table has >= rows
    res["count_seconds"] = round(time.perf_counter() - t0, 2)
    res["recno_unique"] = increasing         # strictly increasing record numbers => unique
    lim = None if (limit is None or rows <= limit) else limit
    res["profiled_rows"] = rows if lim is None else lim
    q = a.quarantine.get(table)
    if q and q.get("group"):
        group = min(group, q["group"])
        res["group"] = group
    cols: dict = {}
    t1 = time.perf_counter()
    for i in range(0, len(t.columns), group):
        part = t.columns[i:i + group]
        acc = [_ColStats(c.type) for c in part]
        for _, vals in a.stream(table, [c.name for c in part], limit=lim):
            for s_, v in zip(acc, vals):
                s_.add(v)
        for c, s_ in zip(part, acc):
            cols[c.name] = s_.result()
    res["read_seconds"] = round(time.perf_counter() - t1, 2)
    res["column_stats"] = cols
    res["empty_columns"] = sum(1 for s in cols.values() if s["filled"] == 0)
    res["date_columns"] = [c.name for c in t.columns if c.type == p.T_DATE]
    res["change_columns"] = [c.name for c in t.columns if CHANGE_RE.search(c.name)]
    res["status"] = "ok"
    return res


def run(out: str | Path, tables: list[str] | None = None, group: int = 100,
        limit: int | None = 200_000, log=print, count_cap: int | None = 2_000_000) -> dict:
    out = Path(out)
    (out / "tables").mkdir(parents=True, exist_ok=True)
    a = Apollo.from_env()
    names = tables or a.schema.names()
    done = {f.stem for f in (out / "tables").glob("*.json")}
    todo = [n for n in names if n not in done]
    log(f"{len(names)} tables, {len(done & set(names))} already profiled, {len(todo)} to do")
    connected = False
    try:
        connected = _run_tables(a, out, todo, group, limit, count_cap, log)
    finally:
        if connected:
            a.close()
        summary = summarize(out)            # always rewrite the overview, also after a crash
    return summary


def _run_tables(a, out, todo, group, limit, count_cap, log) -> bool:
    connected = False
    for n in todo:
        if not policy.allowed(n):
            rule = policy.rules().get(n, {})
            res = {"table": n, "status": "excluded", "error": rule.get("reason", "")}
            (out / "tables" / f"{n}.json").write_text(json.dumps(res, ensure_ascii=False, indent=1),
                                                        encoding="utf-8")
            log(f"{n}: excluded by policy")
            continue
        while True:
            try:
                if not connected:
                    a.connect()
                    connected = True
                res = profile_table(a, n, group=group, limit=limit, count_cap=count_cap)
                break
            except CoolingDown as exc:
                wait = max(60, int(exc.until - time.time()) + 30)
                log(f"cool-down, waiting {wait // 60} min ({exc.reason})")
                time.sleep(wait)
            except TableQuarantined as exc:
                res = {"table": n, "status": "quarantined", "error": str(exc)}
                break
            except p.ServerAbort as exc:
                connected = False                 # session is gone; quarantine + guard recorded
                res = {"table": n, "status": "aborted", "error": str(exc)}
                break
            except p.ProtocolError as exc:        # session stays healthy (drained + closed)
                res = {"table": n, "status": "decode_error", "error": str(exc),
                       "incident": str(getattr(exc, "incident", "") or "")}
                break
            except Exception as exc:              # anything else: log out, reconnect, go on
                inc = incidents.write("profile", n, error=exc)
                res = {"table": n, "status": "error", "error": f"{type(exc).__name__}: {exc}"[:300],
                       "incident": str(inc or "")}
                try:
                    a.close()
                except Exception:
                    pass
                connected = False
                break
        (out / "tables" / f"{n}.json").write_text(json.dumps(res, ensure_ascii=False, indent=1, default=str),
                                                    encoding="utf-8")
        log(f"{n}: {res['status']} rows={res.get('rows')}{'+' if res.get('rows_at_least') else ''} "
            f"read={res.get('read_seconds')}s")
    return connected


def summarize(out: str | Path) -> dict:
    out = Path(out)
    rs = [json.loads(f.read_text(encoding="utf-8")) for f in sorted((out / "tables").glob("*.json"))]
    s = {"tables": len(rs), "ok": sum(r["status"] == "ok" for r in rs),
         "problems": {r["table"]: (r["status"], r.get("error")) for r in rs if r["status"] != "ok"},
         "rows_total": sum(r.get("rows", 0) for r in rs),
         "columns_total": sum(r.get("columns", 0) for r in rs),
         "empty_columns": sum(r.get("empty_columns", 0) for r in rs),
         "tables_with_change_columns": sum(1 for r in rs if r.get("change_columns")),
         "partially_profiled": [r["table"] for r in rs if r.get("profiled_rows", 0) < r.get("rows", 0)]}
    (out / "summary.json").write_text(json.dumps(s, ensure_ascii=False, indent=1), encoding="utf-8")
    # decision proposal per table — a human decides; nothing is applied automatically
    proposal = {}
    for r in rs:
        st = r["status"]
        if st in ("aborted", "quarantined"):
            proposal[r["table"]] = {"read": False, "reason": f"Server-Abbruch beim Lesen ({st}) — Vorschlag: ausschließen"}
        elif st == "excluded":
            proposal[r["table"]] = {"read": False, "reason": r.get("error", "")}
        elif st == "decode_error":
            proposal[r["table"]] = {"read": False, "reason": f"Dekodierfehler: {r.get('error')} — bis zur Klärung ausschließen"}
        elif r.get("rows", 0) == 0:
            proposal[r["table"]] = {"read": True, "reason": "leer (lesbar; ausschließen schadet nicht)"}
        else:
            proposal[r["table"]] = {"read": True, "reason": "lesbar und vollständig dekodierbar"}
    (out / "table_policy.proposal.json").write_text(
        json.dumps({"note": "Vorschlag je Tabelle. Prüfen, anpassen und als APOLLO_SYNC_POLICY-Datei übernehmen.",
                    "tables": dict(sorted(proposal.items()))}, ensure_ascii=False, indent=1), encoding="utf-8")
    lines = ["# Apollo – Lesbarkeit aller Tabellen", "",
             f"{s['ok']} von {s['tables']} Tabellen ok · {s['rows_total']:,} Zeilen · "
             f"{s['columns_total']:,} Spalten, davon {s['empty_columns']:,} ohne Daten", "",
             "Entscheidung je Tabelle: `table_policy.proposal.json` prüfen und als Policy-Datei übernehmen.", "",
             "| Tabelle | Zeilen | Spalten | leer | Lesen s | Änderungsspalten | Status | Vorschlag |",
             "|---|---:|---:|---:|---:|---|---|---|"]
    for r in sorted(rs, key=lambda r: -r.get("rows", 0)):
        pr = proposal[r["table"]]
        lines.append(f"| {r['table']} | {r.get('rows', '')} | {r.get('columns', '')} | {r.get('empty_columns', '')} | "
                     f"{r.get('read_seconds', '')} | {', '.join(r.get('change_columns', []))} | {r['status']} | "
                     f"{'lesen' if pr['read'] else '**ausschließen**'} |")
    (out / "READINESS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return s
